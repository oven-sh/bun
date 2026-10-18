//! A tiny JSON value, so the driver has no dependency outside the rustc sysroot.

#[derive(Clone)]
pub enum J {
    Null,
    Bool(bool),
    Num(i64),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

impl J {
    pub fn obj() -> J {
        J::Obj(Vec::new())
    }

    pub fn set(&mut self, k: &str, v: J) {
        if let J::Obj(o) = self {
            if let Some(slot) = o.iter_mut().find(|(kk, _)| kk == k) {
                slot.1 = v;
            } else {
                o.push((k.to_string(), v));
            }
        }
    }

    pub fn to_string(&self) -> String {
        let mut s = String::new();
        self.write(&mut s);
        s
    }

    fn write(&self, s: &mut String) {
        match self {
            J::Null => s.push_str("null"),
            J::Bool(b) => s.push_str(if *b { "true" } else { "false" }),
            J::Num(n) => s.push_str(&n.to_string()),
            J::Str(x) => {
                s.push('"');
                for c in x.chars() {
                    match c {
                        '"' => s.push_str("\\\""),
                        '\\' => s.push_str("\\\\"),
                        '\n' => s.push_str("\\n"),
                        '\r' => s.push_str("\\r"),
                        '\t' => s.push_str("\\t"),
                        c if (c as u32) < 0x20 => s.push_str(&format!("\\u{:04x}", c as u32)),
                        c => s.push(c),
                    }
                }
                s.push('"');
            }
            J::Arr(a) => {
                s.push('[');
                for (i, v) in a.iter().enumerate() {
                    if i > 0 {
                        s.push(',');
                    }
                    v.write(s);
                }
                s.push(']');
            }
            J::Obj(o) => {
                s.push('{');
                for (i, (k, v)) in o.iter().enumerate() {
                    if i > 0 {
                        s.push(',');
                    }
                    J::Str(k.clone()).write(s);
                    s.push(':');
                    v.write(s);
                }
                s.push('}');
            }
        }
    }
}
