//! <https://urlpattern.spec.whatwg.org/#canon-processing-for-init>

use bun_core::{EncodedSlice, String, strings};
use bun_url::whatwg::{Parsed, URL};

use super::Kind::{self, Hash, Hostname, Password, Pathname, Port, Protocol, Search, Username};
use super::canonicalize::{Encoding, Text, concat, default_port};
use super::parser::escape_pattern_string;
use super::{Components, PatternError, URLPatternInit};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum InitType {
    Pattern,
    Url,
}

#[derive(Default)]
pub(super) struct Init<'t> {
    pub(super) components: Components<Option<EncodedSlice<'t>>>,
    pub(super) base_url: Option<&'t String>,
}

impl<'t> From<&'t URLPatternInit> for Init<'t> {
    fn from(init: &'t URLPatternInit) -> Self {
        let components = Components::from_array([
            &init.protocol,
            &init.username,
            &init.password,
            &init.hostname,
            &init.pathname,
            &init.port,
            &init.search,
            &init.hash,
        ]);
        Self {
            components: components.map(|_, value| value.as_ref().map(String::to_encoded_slice)),
            base_url: init.base_url.as_ref(),
        }
    }
}

impl InitType {
    /// <https://urlpattern.spec.whatwg.org/#process-a-base-url-string>
    fn process_base_url_string(self, text: Text<'_>) -> Result<Text<'_>, PatternError> {
        match self {
            Self::Pattern => escape_pattern_string(&text.get().to_utf8()).map(Text::Owned),
            Self::Url => Ok(text),
        }
    }

    /// <https://urlpattern.spec.whatwg.org/#is-an-absolute-pathname>
    fn is_absolute_pathname(self, pathname: EncodedSlice<'_>) -> bool {
        pathname.starts_with_ascii(b"/")
            || (self == Self::Pattern
                && (pathname.starts_with_ascii(br"\/") || pathname.starts_with_ascii(b"{/")))
    }

    fn resolve_pathname<'t>(
        self,
        pathname: EncodedSlice<'t>,
        base_url: &URL,
    ) -> Result<Text<'t>, PatternError> {
        if !base_url.has_opaque_path() && !self.is_absolute_pathname(pathname) {
            let base_path = self.process_base_url_string(Text::Borrowed(base_url.pathname()))?;
            let base_path = base_path.get().to_utf8();
            if let Some(slash) = strings::last_index_of_char(&base_path, b'/') {
                let directory = EncodedSlice::latin1(&base_path[..=slash]);
                return concat([directory, pathname].into_iter()).map(Text::Owned);
            }
        }
        Ok(Text::Borrowed(pathname))
    }
}

impl<'t> Init<'t> {
    /// Whether a component that is missing comes from the base URL.
    fn inherits(&self, kind: Kind, r#type: InitType) -> bool {
        let unless_given: &[Kind] = match kind {
            Username | Password if r#type == InitType::Pattern => return false,
            Protocol => &[],
            Hostname => &[Protocol],
            Port => &[Protocol, Hostname],
            Username | Pathname => &[Protocol, Hostname, Port],
            Password => &[Protocol, Hostname, Port, Username],
            Search => &[Protocol, Hostname, Port, Pathname],
            Hash => &[Protocol, Hostname, Port, Pathname, Search],
        };
        (unless_given.iter()).all(|&kind| self.components[kind].is_none())
    }

    /// <https://urlpattern.spec.whatwg.org/#process-a-urlpatterninit>. `storage` takes the base URL. What is missing stays as it is in `result`.
    pub(super) fn process(
        &self,
        r#type: InitType,
        storage: &'t mut Option<Parsed>,
        result: &mut Components<Text<'t>>,
    ) -> Result<(), PatternError> {
        let base_url: Option<&URL> = match self.base_url.map(Parsed::from_string) {
            Some(None) => return Err(PatternError::Type("Invalid baseURL.")),
            Some(Some(base_url)) => Some(storage.insert(base_url)),
            None => None,
        };
        for (kind, &value) in &self.components {
            let Some(value) = value else {
                if let Some(base_url) = base_url
                    && self.inherits(kind, r#type)
                {
                    let inherited = Text::component_of(base_url, kind);
                    result[kind] = r#type.process_base_url_string(inherited)?;
                }
                continue;
            };
            let encoding = match kind {
                Protocol => Encoding::Protocol,
                Username => Encoding::Username,
                Password => Encoding::Password,
                Hostname => Encoding::Hostname,
                Pathname => Encoding::of_pathname(result[Protocol].get()),
                Port => Encoding::Port {
                    default: default_port(result[Protocol].get()),
                },
                Search => Encoding::Search,
                Hash => Encoding::Hash,
            };
            let value = match (kind, base_url) {
                (Pathname, Some(base_url)) => r#type.resolve_pathname(value, base_url)?,
                _ if r#type == InitType::Pattern => {
                    Text::Borrowed(encoding.without_delimiter(value))
                }
                _ => Text::Borrowed(value),
            };
            result[kind] = match r#type {
                InitType::Pattern => value,
                InitType::Url => encoding.canonicalize(value.get())?,
            };
        }
        Ok(())
    }
}
