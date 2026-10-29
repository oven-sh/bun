use serde::{Deserialize, Deserializer};

/// A property of a JSON object may be missing (None), null (Some(None)), or have a value.
type Field<T> = Option<Option<T>>;

fn present<'de, T: Deserialize<'de>, D: Deserializer<'de>>(deserializer: D) -> Result<Field<T>, D::Error> {
    Option::<T>::deserialize(deserializer).map(Some)
}

/// What comes in for a new issue or for a change to one.
#[derive(Deserialize, Default)]
pub struct IssueInput {
    #[serde(default, deserialize_with = "present")]
    pub title: Field<String>,
    #[serde(default, deserialize_with = "present")]
    pub body: Field<String>,
    #[serde(default, deserialize_with = "present")]
    pub priority: Field<i64>,
    #[serde(default, deserialize_with = "present")]
    pub labels: Field<Vec<Option<String>>>,
    #[serde(default, deserialize_with = "present")]
    pub assignee: Field<String>,
    #[serde(default, deserialize_with = "present")]
    pub state: Field<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommentInput {
    #[serde(default, deserialize_with = "present")]
    pub body: Field<String>,
    #[serde(default, deserialize_with = "present")]
    pub parent_id: Field<i64>,
}

/// Where a value is wrong. `malformed`: something has another type than it should have, or is missing.
#[derive(Default)]
pub struct Refusal {
    pub invalid: Vec<String>,
    pub malformed: bool,
}

impl Refusal {
    pub fn of(path: &str) -> Self {
        Refusal { invalid: vec![path.to_string()], malformed: false }
    }

    pub fn malformed() -> Self {
        Refusal { invalid: Vec::new(), malformed: true }
    }

    fn wrong(&mut self, path: &str) {
        self.invalid.push(path.to_string());
    }

    fn wrong_type(&mut self, path: &str) {
        self.wrong(path);
        self.malformed = true;
    }

    fn text(&mut self, path: &str, field: &Field<String>, required: bool, least: usize, most: usize) {
        match field {
            None if !required => {}
            None | Some(None) => self.wrong_type(path),
            Some(Some(text)) => {
                if !(least..=most).contains(&utf16_length(text)) {
                    self.wrong(path);
                }
            }
        }
    }

    fn whole(&mut self, path: &str, field: &Field<i64>, required: bool, least: i64, most: i64) {
        match field {
            None if !required => {}
            None | Some(None) => self.wrong_type(path),
            Some(Some(n)) => {
                if !(least..=most).contains(n) {
                    self.wrong(path);
                }
            }
        }
    }
}

/// The length of a string as JavaScript counts it.
pub fn utf16_length(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

pub fn is_login(text: &str) -> bool {
    (1..=60).contains(&text.len()) && text.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

impl IssueInput {
    pub fn check(&self, required: bool) -> Refusal {
        let mut refusal = Refusal::default();
        refusal.text("title", &self.title, required, 1, 200);
        refusal.text("body", &self.body, required, 0, 20000);
        refusal.whole("priority", &self.priority, required, 0, 3);
        match &self.labels {
            None if !required => {}
            None | Some(None) => refusal.wrong_type("labels"),
            Some(Some(labels)) => {
                if labels.len() > 12 {
                    refusal.wrong("labels");
                }
                for (i, label) in labels.iter().enumerate() {
                    match label {
                        None => refusal.wrong_type(&format!("labels.{i}")),
                        Some(label) if !(1..=50).contains(&utf16_length(label)) => refusal.wrong(&format!("labels.{i}")),
                        Some(_) => {}
                    }
                }
            }
        }
        if let Some(Some(assignee)) = &self.assignee {
            if !is_login(assignee) {
                refusal.wrong("assignee");
            }
        }
        if !required {
            match &self.state {
                None => {}
                Some(Some(state)) if state == "open" || state == "closed" => {}
                Some(_) => refusal.wrong_type("state"),
            }
        }
        refusal
    }

    pub fn label_names(&self) -> Option<Vec<String>> {
        Some(self.labels.as_ref()?.as_ref()?.iter().flatten().cloned().collect())
    }
}

impl CommentInput {
    pub fn check(&self) -> Refusal {
        let mut refusal = Refusal::default();
        refusal.text("body", &self.body, true, 1, 20000);
        if let Some(Some(_)) = self.parent_id {
            refusal.whole("parentId", &self.parent_id, true, 1, 2_147_483_647);
        }
        refusal
    }
}

/// The body of a request as a JSON object. None: it is something else.
pub fn object_of<'a, T: Deserialize<'a>>(body: &'a [u8]) -> Option<T> {
    let first = body.iter().find(|byte| !byte.is_ascii_whitespace())?;
    if *first != b'{' {
        return None;
    }
    serde_json::from_slice(body).ok()
}
