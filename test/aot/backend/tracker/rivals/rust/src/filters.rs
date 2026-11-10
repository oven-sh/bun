use serde::Serialize;

use crate::format::push_int;
use crate::markdown::end_of_run;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IssueFilters {
    pub state: &'static str,
    pub label: Option<String>,
    pub sort: &'static str,
    pub page: i64,
    pub per_page: i64,
}

/// The whole number that the text begins with, as JavaScript's parseInt reads it, held between least and most.
pub fn whole_number(text: &str, fallback: i64, least: i64, most: i64) -> i64 {
    let text = text.trim_start_matches([' ', '\t', '\n', '\r', '\x0b', '\x0c']);
    let (negative, text) = match text.as_bytes().first() {
        Some(b'-') => (true, &text[1..]),
        Some(b'+') => (false, &text[1..]),
        _ => (false, text),
    };
    let end = end_of_run(text, 0, |byte| byte.is_ascii_digit());
    if end == 0 {
        return fallback;
    }
    let n = text[..end].parse::<i64>().unwrap_or(i64::MAX);
    (if negative { -n } else { n }).clamp(least, most)
}

/// The number that a part of a path spells, if it is one that a row can have.
pub fn positive_integer(text: &str) -> Option<i32> {
    if text.is_empty() || text.len() > 9 || text.starts_with('0') || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

/// The first value of a name in a query string.
pub fn parameter(query: &str, name: &str) -> Option<String> {
    form_urlencoded::parse(query.as_bytes()).find(|(key, _)| key == name).map(|(_, value)| value.into_owned())
}

pub fn parse_filters(query: &str, per_page: i64, most_per_page: i64) -> IssueFilters {
    let mut filters = IssueFilters { state: "open", label: None, sort: "updated", page: 1, per_page };
    let (mut state, mut label, mut sort, mut page, mut size) = (false, false, false, false, false);
    for (name, value) in form_urlencoded::parse(query.as_bytes()) {
        match &*name {
            "state" if !std::mem::replace(&mut state, true) => {
                if value == "closed" {
                    filters.state = "closed";
                }
            }
            "label" if !std::mem::replace(&mut label, true) => {
                if !value.is_empty() {
                    filters.label = Some(value.into_owned());
                }
            }
            "sort" if !std::mem::replace(&mut sort, true) => match &*value {
                "created" => filters.sort = "created",
                "comments" => filters.sort = "comments",
                _ => {}
            },
            "page" if !std::mem::replace(&mut page, true) => filters.page = whole_number(&value, 1, 1, 100_000),
            "per_page" if !std::mem::replace(&mut size, true) => filters.per_page = whole_number(&value, per_page, 1, most_per_page),
            _ => {}
        }
    }
    filters
}

/// The address of the list of a project's issues under these filters. What is as by default is left out.
pub fn issue_list_url(project_slug: &str, state: &str, label: Option<&str>, sort: &str, page: i64) -> String {
    let mut address = String::with_capacity(96);
    address.push_str("/p/");
    address.push_str(project_slug);
    address.push_str("/issues");
    let mut separator = '?';
    let mut add = |name: &str, value: &str| {
        address.push(separator);
        address.push_str(name);
        address.push('=');
        address.extend(form_urlencoded::byte_serialize(value.as_bytes()));
        separator = '&';
    };
    if state != "open" {
        add("state", state);
    }
    if let Some(label) = label {
        add("label", label);
    }
    if sort != "updated" {
        add("sort", sort);
    }
    if page != 1 {
        let mut digits = String::new();
        push_int(&mut digits, page);
        add("page", &digits);
    }
    address
}
