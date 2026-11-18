//! UTS #46 as the URL Standard and `node:url` use it.

use bun_engine_text::{CodeUnit, StringBuilder, StringRef, StringWriter, Text, with_text};
use bun_icu::idna::{self, Name, Verdict};

use crate::buffer::Buffer;
use crate::punycode::{self, MAX_LABEL_LENGTH};
use crate::{Error, Punycode, Result, Url};

/// The most code units that are converted. DNS resolves names of up to 253 bytes.
const MAX_NAME_LENGTH: usize = 4096;

type Conversion = fn(&[u16], &mut Name) -> bun_icu::Result<Verdict>;

fn convert(
    conversion: Conversion,
    name: impl Iterator<Item = char>,
    out: &mut Name,
) -> Result<Verdict> {
    let mut units = Name::new();
    for character in name {
        let length = character.len_utf16();
        if units.len() + length > MAX_NAME_LENGTH || units.try_reserve(length).is_err() {
            return Err(Error::OutOfMemory);
        }
        units.extend_from_slice(character.encode_utf16(&mut [0; 2]));
    }
    conversion(&units, out).map_err(|error| match error {
        bun_icu::Error::MEMORY_ALLOCATION => Error::OutOfMemory,
        _ => Error::Invalid,
    })
}

/// A lone surrogate becomes U+FFFD.
fn scalar_values(text: Text<'_>) -> impl Iterator<Item = char> {
    text.code_points()
        .map(|code_point| char::from_u32(code_point).unwrap_or(char::REPLACEMENT_CHARACTER))
}

fn labels(domain: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut rest = Some(domain);
    core::iter::from_fn(move || {
        let text = rest?;
        let dot = bun_highway::index_of_char(text, b'.');
        rest = dot.map(|dot| &text[dot + 1..]);
        Some(&text[..dot.unwrap_or(text.len())])
    })
}

fn ace_labels(domain: &[u8]) -> impl Iterator<Item = &[u8]> {
    labels(domain).filter(|label| label.starts_with(b"xn--"))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Label {
    Valid,
    /// The steps Map and Normalize would change it, or it does not meet the validity criteria.
    NotValidAsItIs,
    /// It takes the rules for joiners or the Bidi Rule to tell.
    Undecided,
}

/// For up to [`MAX_LABEL_LENGTH`] characters, and at least one.
fn judge(label: &[char]) -> Label {
    if matches!(label, ['x', 'n', '-', '-', ..])
        || idna::is_mark(label[0])
        || label.contains(&char::REPLACEMENT_CHARACTER)
    {
        return Label::NotValidAsItIs;
    }
    let mut units = [0; 2 * MAX_LABEL_LENGTH];
    let mut length = 0;
    for character in label {
        length += character.encode_utf16(&mut units[length..]).len();
    }
    let needs_context = |&character: &char| {
        !character.is_ascii()
            && (matches!(character, '\u{200c}' | '\u{200d}') || idna::is_right_to_left(character))
    };
    match idna::is_mapped(&units[..length]) {
        Ok(false) => Label::NotValidAsItIs,
        Ok(true) if !label.iter().any(needs_context) => Label::Valid,
        _ => Label::Undecided,
    }
}

fn judge_ace_label(label: &[u8]) -> Label {
    if label.len() > MAX_LABEL_LENGTH {
        return Label::Undecided;
    }
    match punycode::decode(&label["xn--".len()..], &mut ['\0'; MAX_LABEL_LENGTH]) {
        Some(decoded @ [_, ..]) if !label.ends_with(b"-") => judge(decoded),
        _ => Label::NotValidAsItIs,
    }
}

/// ToASCII of a name to which there is nothing to do but to encode its labels. False for any other.
fn encode_labels(domain: &[u8], out: &mut Buffer) -> Result<bool> {
    for (index, label) in labels(domain).enumerate() {
        if index != 0 {
            out.push(b'.')?;
        }
        if label.is_ascii() && !label.starts_with(b"xn--") {
            out.extend(label)?;
            continue;
        }
        let mut characters = ['\0'; MAX_LABEL_LENGTH];
        let mut count = 0;
        let label = core::str::from_utf8(label).map_err(|_| Error::Invalid)?;
        for character in label.chars() {
            let Some(slot) = characters.get_mut(count) else {
                return Ok(false);
            };
            *slot = character;
            count += 1;
        }
        if judge(&characters[..count]) != Label::Valid {
            return Ok(false);
        }
        out.extend(b"xn--")?;
        punycode::encode(&characters[..count], out)?;
    }
    Ok(true)
}

/// Domain parser ToASCII, for UTF-8 whose ASCII is lowercase.
pub(crate) fn encode(domain: &[u8], out: &mut Buffer) -> Result<()> {
    if domain.len() > MAX_NAME_LENGTH {
        return Err(Error::Invalid);
    }
    if encode_labels(domain, out)? {
        return Ok(());
    }
    out.truncate(0);
    let text = core::str::from_utf8(domain).map_err(|_| Error::Invalid)?;
    let mut ascii = Name::new();
    if convert(idna::to_ascii, text.chars(), &mut ascii) != Ok(Verdict::Valid) {
        return Err(Error::Invalid);
    }
    for &unit in &ascii {
        let byte = u8::from_u16(unit).filter(u8::is_ascii);
        out.push(byte.ok_or(Error::Invalid)?)?;
    }
    Ok(())
}

/// Whether ToASCII records no error for a lowercase ASCII domain.
pub(crate) fn has_valid_ace_labels(domain: &[u8]) -> bool {
    let mut is_decided = true;
    for label in ace_labels(domain) {
        match judge_ace_label(label) {
            Label::Valid => {}
            Label::NotValidAsItIs => return false,
            Label::Undecided => is_decided = false,
        }
    }
    let characters = domain.iter().map(|&byte| char::from(byte));
    is_decided || convert(idna::to_ascii, characters, &mut Name::new()) == Ok(Verdict::Valid)
}

/// `name` in lowercase, if that is all there is to do in either direction.
fn lowercase_if_plain(name: Text<'_>) -> Result<Option<StringRef>> {
    if !name.is_ascii() {
        return Ok(None);
    }
    let mut writer = StringWriter::<u8>::try_new(name.len())?;
    with_text!(name, |units| writer
        .push_mapped(units, |unit| (unit.to_u16() as u8)
            .to_ascii_lowercase()));
    let lowercase = writer.finish();
    let has_ace_label =
        u8::units(lowercase.text()).is_some_and(|it| ace_labels(it).next().is_some());
    Ok((!has_ace_label).then_some(lowercase))
}

/// What ToASCII does about the errors that it records.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum OnError {
    Fail,
    Ignore,
}

/// ToASCII of a name that need not be a host.
pub fn name_to_ascii(name: Text<'_>, on_error: OnError) -> Result<StringRef> {
    if let Some(lowercase) = lowercase_if_plain(name)? {
        return Ok(lowercase);
    }
    let mut out = Name::new();
    let verdict = convert(idna::to_ascii, scalar_values(name), &mut out)?;
    if verdict == Verdict::Invalid && on_error == OnError::Fail {
        return Err(Error::Invalid);
    }
    Ok(StringRef::try_narrowed(Text::Utf16(&out))?)
}

/// ToUnicode, whatever errors it records.
pub fn name_to_unicode(name: Text<'_>) -> Result<StringRef> {
    if let Some(lowercase) = lowercase_if_plain(name)? {
        return Ok(lowercase);
    }
    let mut out = Name::new();
    convert(idna::to_unicode, scalar_values(name), &mut out)?;
    Ok(StringRef::try_narrowed(Text::Utf16(&out))?)
}

/// The `hostname` that a URL of a special scheme has once `domain` is assigned to it.
pub fn domain_to_ascii(domain: Text<'_>) -> Result<StringRef> {
    let mut url = Url::parse(Text::from_ascii("ws://x/"), None, Punycode::Unchecked)?;
    url.set_hostname(domain, Punycode::Checked)?;
    Ok(StringRef::try_from_units(url.hostname())?)
}

/// ToUnicode of [`domain_to_ascii`], whose labels do not depend on each other.
pub fn domain_to_unicode(domain: Text<'_>) -> Result<StringRef> {
    let (ascii, mut unicode) = (domain_to_ascii(domain)?, StringBuilder::new());
    for (index, label) in labels(u8::units(ascii.text()).unwrap_or_default()).enumerate() {
        if index != 0 {
            unicode.push_unit(b'.'.into());
        }
        match label.starts_with(b"xn--") {
            true => unicode.push_text(name_to_unicode(Text::Latin1(label))?.text()),
            false => unicode.push_text(Text::Latin1(label)),
        }
    }
    Ok(unicode.finish()?)
}
