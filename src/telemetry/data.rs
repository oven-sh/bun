//! Attribute/event/link limits (OTEL_SPAN_*_LIMIT).

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub attributes: u16,
    pub events: u16,
    pub links: u16,
    pub attribute_value_length: u32,
}

pub const DEFAULT_LIMITS: Limits = Limits {
    attributes: 128,
    events: 128,
    links: 128,
    attribute_value_length: u32::MAX,
};
