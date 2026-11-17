//! <https://html.spec.whatwg.org/#sandboxing>

use bun_core::strings;
use bun_web::headers::trim_http_whitespace;

/// What a document is allowed, if it is sandboxed.
#[derive(Clone, Default)]
pub(super) struct Sandbox(Option<Vec<Vec<u8>>>);

impl Sandbox {
    pub(super) fn flags(&self) -> Option<&[Vec<u8>]> {
        self.0.as_deref()
    }

    pub(super) fn is_on(&self) -> bool {
        self.0.is_some()
    }

    pub(super) fn forbids(&self, flag: &str) -> bool {
        self.0
            .as_ref()
            .is_some_and(|it| it.iter().all(|it| it != flag.as_bytes()))
    }

    /// <https://html.spec.whatwg.org/#hand-off-to-external-software>
    pub(super) fn allows_hand_off(&self, is_by_user: bool) -> bool {
        !self.forbids("allow-top-navigation-to-custom-protocols")
            || !self.forbids("allow-popups")
            || !self.forbids("allow-top-navigation")
            || (is_by_user && !self.forbids("allow-top-navigation-by-user-activation"))
    }

    pub(super) fn of_popups(self) -> Sandbox {
        if self.forbids("allow-popups-to-escape-sandbox") {
            self
        } else {
            Sandbox::default()
        }
    }

    pub(super) fn keep_only(&mut self, allowed: Vec<Vec<u8>>) {
        match &mut self.0 {
            Some(flags) => flags.retain(|it| allowed.contains(it)),
            None => self.0 = Some(allowed),
        }
    }

    pub(super) fn restrict(&mut self, tokens: &[u8]) {
        let tokens = strings::split_any(tokens, b"\t\n\x0c\r ").filter(|it| !it.is_empty());
        self.keep_only(tokens.map(<[u8]>::to_ascii_lowercase).collect());
    }

    pub(super) fn restrict_by_policy(&mut self, header: &[u8]) {
        for directive in strings::split_any(header, b";,").map(trim_http_whitespace) {
            if let Some((name, tokens)) = directive.split_at_checked(b"sandbox".len())
                && name.eq_ignore_ascii_case(b"sandbox")
                && tokens.first().is_none_or(u8::is_ascii_whitespace)
            {
                self.restrict(tokens);
            }
        }
    }
}
