use bun_core::strings;

fn is_field(token: &[u8]) -> bool {
    strings::tokenize(b"name honorific-prefix given-name additional-name family-name honorific-suffix nickname username new-password \
        current-password one-time-code organization-title organization street-address address-line1 address-line2 \
        address-line3 address-level4 address-level3 address-level2 address-level1 country country-name postal-code cc-name \
        cc-given-name cc-additional-name cc-family-name cc-number cc-exp cc-exp-month cc-exp-year cc-csc cc-type \
        transaction-currency transaction-amount language bday bday-day bday-month bday-year sex url photo", b" ").any(|it| it == token)
}

fn is_contact_field(token: &[u8]) -> bool {
    strings::tokenize(b"tel tel-country-code tel-national tel-area-code tel-local tel-local-prefix tel-local-suffix tel-extension email impp", b" ").any(|it| it == token)
}

/// https://html.spec.whatwg.org/#idl-exposed-autofill-value
pub(crate) fn exposed_value(attribute: &[u8], is_hidden: bool) -> Vec<u8> {
    let lower = attribute.to_ascii_lowercase();
    let tokens: Vec<_> = strings::tokenize_any(&lower, b"\t\n\x0c\r ").collect();
    let mut rest = &tokens[..];
    let mut take = |fits: &dyn Fn(&[u8]) -> bool| {
        rest.split_last()
            .filter(|it| fits(it.0))
            .map(|it| rest = it.1)
            .is_some()
    };
    let is_valid = match tokens[..] {
        [b"on" | b"off"] => !is_hidden,
        [b"webauthn"] => true,
        _ => {
            take(&|it| it == b"webauthn");
            let is_contact = take(&|it| is_contact_field(it));
            let has_field = is_contact || take(&|it| is_field(it));
            take(&|it| {
                is_contact && matches!(it, b"home" | b"work" | b"mobile" | b"fax" | b"pager")
            });
            take(&|it| matches!(it, b"shipping" | b"billing"));
            take(&|it| it.starts_with(b"section-"));
            has_field && rest.is_empty()
        }
    };
    if is_valid {
        tokens.join(&b' ')
    } else {
        Vec::new()
    }
}
