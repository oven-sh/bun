//! Where things are written in a configuration file, for errors that point at them. [`crate::json::Json`] has what they say.
//!
//! As tolerant as configuration files are read: comments, a comma after the last element, names and strings in single quotes.

/// Something written, from `from` to `to`.
#[derive(Debug)]
pub struct Value {
    pub from: u32,
    pub to: u32,
    pub what: Written,
}

#[derive(Debug)]
pub enum Written {
    Object(Vec<Member>),
    Array(Vec<Value>),
    /// A string, a number, a word.
    Other,
}

/// `"name": value`
#[derive(Debug)]
pub struct Member {
    pub name: String,
    /// The name with its quotes.
    pub name_from: u32,
    pub name_to: u32,
    pub value: Value,
}

impl Value {
    /// `ForEachPropertyAssignment`: the first member called `name` or `other`.
    pub fn member(&self, name: &str, other: &str) -> Option<&Member> {
        match &self.what {
            Written::Object(members) => members
                .iter()
                .find(|m| m.name == name || !other.is_empty() && m.name == other),
            _ => None,
        }
    }

    pub fn element(&self, index: usize) -> Option<&Value> {
        match &self.what {
            Written::Array(elements) => elements.get(index),
            _ => None,
        }
    }
}

struct Reader<'a> {
    text: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn skip_trivia(&mut self) {
        loop {
            match self.text.get(self.at) {
                Some(b' ' | b'\t' | b'\r' | b'\n') => self.at += 1,
                // A mark at the start of the file.
                Some(0xEF) if self.text[self.at..].starts_with(&[0xEF, 0xBB, 0xBF]) => self.at += 3,
                Some(b'/') if self.text.get(self.at + 1) == Some(&b'/') => {
                    self.at += bun_core::strings::index_of_char_usize(&self.text[self.at..], b'\n')
                        .unwrap_or(self.text.len() - self.at);
                }
                Some(b'/') if self.text.get(self.at + 1) == Some(&b'*') => {
                    self.at += bun_core::strings::index_of(&self.text[self.at + 2..], b"*/")
                        .map_or(self.text.len() - self.at, |end| end + 4);
                }
                _ => return,
            }
        }
    }

    /// Past the string that starts here. What it says, escapes left as they are.
    fn string(&mut self) -> String {
        let quote = self.text[self.at];
        let start = self.at + 1;
        self.at = start;
        while self.at < self.text.len()
            && self.text[self.at] != quote
            && self.text[self.at] != b'\n'
        {
            self.at += 1 + usize::from(self.text[self.at] == b'\\');
        }
        let end = self.at.min(self.text.len());
        self.at = (end + 1).min(self.text.len());
        String::from_utf8_lossy(&self.text[start..end]).into_owned()
    }

    fn word(&mut self) {
        while self.text.get(self.at).is_some_and(|c| {
            !matches!(
                c,
                b',' | b'}' | b']' | b':' | b' ' | b'\t' | b'\r' | b'\n' | b'/'
            )
        }) {
            self.at += 1;
        }
    }

    fn value(&mut self, depth: usize) -> Option<Value> {
        self.skip_trivia();
        let from = self.at as u32;
        let what = match *self.text.get(self.at)? {
            _ if depth > 64 => return None,
            b'{' => {
                self.at += 1;
                let mut members = Vec::new();
                loop {
                    self.skip_trivia();
                    match *self.text.get(self.at)? {
                        b'}' => {
                            self.at += 1;
                            break;
                        }
                        b',' => self.at += 1,
                        c => {
                            let name_from = self.at as u32;
                            let name = if matches!(c, b'"' | b'\'') {
                                self.string()
                            } else {
                                self.word();
                                if self.at as u32 == name_from {
                                    return None;
                                }
                                String::from_utf8_lossy(&self.text[name_from as usize..self.at])
                                    .into_owned()
                            };
                            let name_to = self.at as u32;
                            self.skip_trivia();
                            if self.text.get(self.at) != Some(&b':') {
                                continue;
                            }
                            self.at += 1;
                            members.push(Member {
                                name,
                                name_from,
                                name_to,
                                value: self.value(depth + 1)?,
                            });
                        }
                    }
                }
                Written::Object(members)
            }
            b'[' => {
                self.at += 1;
                let mut elements = Vec::new();
                loop {
                    self.skip_trivia();
                    match *self.text.get(self.at)? {
                        b']' => {
                            self.at += 1;
                            break;
                        }
                        b',' => self.at += 1,
                        _ => elements.push(self.value(depth + 1)?),
                    }
                }
                Written::Array(elements)
            }
            b'"' | b'\'' => {
                self.string();
                Written::Other
            }
            _ => {
                self.word();
                if self.at as u32 == from {
                    return None;
                }
                Written::Other
            }
        };
        Some(Value {
            from,
            to: self.at as u32,
            what,
        })
    }
}

/// `None`: it cannot be made sense of.
pub fn parse(text: &[u8]) -> Option<Value> {
    Reader { text, at: 0 }.value(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_what_is_written() {
        let text = br#"{
  // a comment
  "compilerOptions": {
    "strict": true, /* another */
    'paths': { "a/*": ["./x/*", "y"], },
  },
}"#;
        let slice =
            |from: u32, to: u32| std::str::from_utf8(&text[from as usize..to as usize]).unwrap();
        let root = parse(text).unwrap();
        let options = root.member("compilerOptions", "").unwrap();
        assert_eq!(
            slice(options.name_from, options.name_to),
            "\"compilerOptions\""
        );
        let strict = options.value.member("strict", "").unwrap();
        assert_eq!(slice(strict.value.from, strict.value.to), "true");
        let paths = options.value.member("nothing", "paths").unwrap();
        assert_eq!(slice(paths.name_from, paths.name_to), "'paths'");
        let pattern = paths.value.member("a/*", "").unwrap();
        let second = pattern.value.element(1).unwrap();
        assert_eq!(slice(second.from, second.to), "\"y\"");
        assert!(pattern.value.element(2).is_none());
    }

    #[test]
    fn gives_up_on_what_is_cut_off() {
        assert!(parse(b"{ \"a\": [1, ").is_none());
        assert!(parse(b"").is_none());
    }
}
