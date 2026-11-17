//! https://w3c.github.io/webappsec-permissions-policy/

use bun_core::strings;

use crate::Bytes;
use crate::csp::source_matches_origin;
use crate::origin::Origin;
use crate::structured::{Bare, parse_dictionary};
use crate::url::Url;

keywords! {
    pub enum Feature {
        Accelerometer = b"accelerometer",
        AriaNotify = b"aria-notify",
        Autoplay = b"autoplay",
        Bluetooth = b"bluetooth",
        Camera = b"camera",
        CapturedSurfaceControl = b"captured-surface-control",
        ClipboardRead = b"clipboard-read",
        ClipboardWrite = b"clipboard-write",
        ComputePressure = b"compute-pressure",
        CrossOriginIsolated = b"cross-origin-isolated",
        DeferredFetch = b"deferred-fetch",
        DeferredFetchMinimal = b"deferred-fetch-minimal",
        DigitalCredentialsGet = b"digital-credentials-get",
        DisplayCapture = b"display-capture",
        EncryptedMedia = b"encrypted-media",
        FocusWithoutUserActivation = b"focus-without-user-activation",
        Fullscreen = b"fullscreen",
        Gamepad = b"gamepad",
        Geolocation = b"geolocation",
        Gyroscope = b"gyroscope",
        Hid = b"hid",
        IdentityCredentialsGet = b"identity-credentials-get",
        IdleDetection = b"idle-detection",
        KeyboardMap = b"keyboard-map",
        LocalFonts = b"local-fonts",
        Magnetometer = b"magnetometer",
        Microphone = b"microphone",
        Midi = b"midi",
        OtpCredentials = b"otp-credentials",
        Payment = b"payment",
        PictureInPicture = b"picture-in-picture",
        PublickeyCredentialsCreate = b"publickey-credentials-create",
        PublickeyCredentialsGet = b"publickey-credentials-get",
        ScreenWakeLock = b"screen-wake-lock",
        Serial = b"serial",
        StorageAccess = b"storage-access",
        SyncXhr = b"sync-xhr",
        Unload = b"unload",
        Usb = b"usb",
        WebShare = b"web-share",
        WindowManagement = b"window-management",
        XrSpatialTracking = b"xr-spatial-tracking",
    }
}

impl Feature {
    pub fn all() -> impl Iterator<Item = Feature> {
        Feature::ALL.iter().copied()
    }

    fn is_for_all_by_default(self) -> bool {
        use Feature::*;
        matches!(
            self,
            AriaNotify
                | DeferredFetchMinimal
                | Gamepad
                | PictureInPicture
                | StorageAccess
                | SyncXhr
                | Unload
        )
    }
}

#[derive(Clone, Default)]
struct Allowlist {
    has_all: bool,
    /// For a frame whose `src` is sandboxed.
    has_opaque: bool,
    origins: Vec<Origin>,
    expressions: Vec<Bytes>,
    report_to: Option<Bytes>,
}

impl Allowlist {
    fn matches(&self, origin: &Origin) -> bool {
        self.has_all
            || self.origins.contains(origin)
            || (self.has_opaque && origin.is_opaque())
            || self
                .expressions
                .iter()
                .any(|it| source_matches_origin(it, origin))
    }
}

/// What a header or the attributes of a frame say.
#[derive(Clone, Default)]
pub struct Declared(Vec<(Feature, Allowlist)>);

impl Declared {
    fn get(&self, feature: Feature) -> Option<&Allowlist> {
        self.0.iter().find(|it| it.0 == feature).map(|it| &it.1)
    }

    pub fn from_header(value: &[u8], own: &Origin) -> Declared {
        let members = parse_dictionary(value).unwrap_or_default();
        let declared = members.iter().filter_map(|(name, value, parameters)| {
            let mut list = Allowlist {
                report_to: parameters.text(b"report-to").map(Bytes::from),
                ..Allowlist::default()
            };
            for item in value.items() {
                match item {
                    Bare::Token(b"*") => list.has_all = true,
                    Bare::Token(b"self") => list.origins.push(own.clone()),
                    Bare::String(expression) if strings::contains_char(expression, b':') => {
                        list.expressions.push((**expression).into())
                    }
                    _ => {}
                }
            }
            Some((Feature::parse(name)?, list))
        });
        Declared(declared.collect())
    }

    /// The syntax of `allow` and of `Feature-Policy`, which has no `src`. What has been declared already stays.
    pub fn add_directives(&mut self, value: &[u8], own: &Origin, src: Option<&Origin>) {
        for directive in strings::split_any(value, if src.is_some() { b";" } else { b";," }) {
            let mut words = strings::tokenize_any(directive, b"\t\n\x0c\r ").peekable();
            let Some(feature) = words
                .next()
                .and_then(Feature::parse)
                .filter(|it| self.get(*it).is_none())
            else {
                continue;
            };
            let implied = words.peek().is_none().then_some(if src.is_some() {
                &b"'src'"[..]
            } else {
                b"'self'"
            });
            let mut list = Allowlist::default();
            for word in words.chain(implied) {
                match (&*word.to_ascii_lowercase(), src) {
                    (b"*", _) => list.has_all = true,
                    (b"'self'", _) => list.origins.push(own.clone()),
                    (b"'src'", Some(src)) if src.is_opaque() => list.has_opaque = true,
                    (b"'src'", Some(src)) => list.origins.push(src.clone()),
                    _ => list.origins.extend(
                        Url::parse(word)
                            .map(|it| Origin::of(&it))
                            .filter(|it| !it.is_opaque()),
                    ),
                }
            }
            self.0.push((feature, list));
        }
    }

    pub fn forget_opaque_src(&mut self) {
        self.0.iter_mut().for_each(|it| it.1.has_opaque = false);
    }
}

#[derive(Clone)]
pub struct PermissionsPolicy {
    origin: Origin,
    /// A bit for each feature.
    not_inherited: u64,
    declared: Declared,
}

impl PermissionsPolicy {
    /// `container` is the policy of the document that it is a frame of, and what the element declares.
    pub fn new(
        origin: Origin,
        container: Option<(&PermissionsPolicy, &Declared)>,
        declared: Declared,
    ) -> PermissionsPolicy {
        let is_inherited = |feature| {
            container
                .is_none_or(|(parent, by_element)| parent.delegates(feature, by_element, &origin))
        };
        let not_inherited = Feature::all()
            .filter(|it| !is_inherited(*it))
            .fold(0, |bits, it| bits | 1 << it as u32);
        PermissionsPolicy {
            origin,
            not_inherited,
            declared,
        }
    }

    fn inherits(&self, feature: Feature) -> bool {
        self.not_inherited & 1 << feature as u32 == 0
    }

    fn is_allowed_by_default(&self, feature: Feature, origin: &Origin) -> bool {
        feature.is_for_all_by_default() || *origin == self.origin
    }

    /// https://w3c.github.io/webappsec-permissions-policy/#algo-define-inherited-policy-in-container
    fn delegates(&self, feature: Feature, by_element: &Declared, origin: &Origin) -> bool {
        self.allows(feature)
            && self
                .declared
                .get(feature)
                .is_none_or(|it| it.matches(origin))
            && by_element.get(feature).map_or_else(
                || self.is_allowed_by_default(feature, origin),
                |it| it.matches(origin),
            )
    }

    pub fn allows_for(&self, feature: Feature, origin: &Origin) -> bool {
        self.inherits(feature)
            && self.declared.get(feature).map_or_else(
                || self.is_allowed_by_default(feature, origin),
                |it| it.matches(origin),
            )
    }

    pub fn allows(&self, feature: Feature) -> bool {
        self.allows_for(feature, &self.origin)
    }

    pub fn endpoint(&self, feature: Feature) -> Option<&[u8]> {
        self.declared.get(feature)?.report_to.as_deref()
    }

    pub fn allowlist(&self, feature: Feature) -> Vec<&[u8]> {
        match self.declared.get(feature) {
            _ if !self.allows(feature) => Vec::new(),
            Some(list) if !list.has_all => list
                .origins
                .iter()
                .map(Origin::as_bytes)
                .chain(list.expressions.iter().map(|it| &**it))
                .collect(),
            None if !feature.is_for_all_by_default() => vec![self.origin.as_bytes()],
            _ => vec![b"*"],
        }
    }
}
