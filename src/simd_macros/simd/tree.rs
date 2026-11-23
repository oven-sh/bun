//! Tokens that are fetched from rustc once. Each look into a group is a call, and cargo doesn't optimize macros.
use proc_macro::{Delimiter, Ident, Literal, Punct, Span, TokenStream, TokenTree};
use std::{cell::OnceCell, fmt, rc::Rc};

#[derive(Clone)]
pub enum T {
    Group(Group),
    Ident(Word),
    Punct(Punct),
    Literal(Literal),
}
#[derive(Clone)]
pub struct Word(Ident, pub Rc<str>);
#[derive(Clone)]
pub struct Group(Rc<Parts>);
struct Parts {
    delimiter: Delimiter,
    span: Span,
    /// One of the two is there. What comes from rustc goes back as it is.
    real: OnceCell<proc_macro::Group>,
    raw: OnceCell<Vec<T>>,
    opened: OnceCell<Vec<T>>,
}
pub fn trees(from: TokenStream) -> Vec<T> {
    let one = |t| match t {
        TokenTree::Group(it) => {
            let (delimiter, span) = (it.delimiter(), it.span());
            T::Group(Group(
                Parts { delimiter, span, real: it.into(), raw: OnceCell::new(), opened: OnceCell::new() }.into(),
            ))
        }
        TokenTree::Ident(it) => it.into(),
        TokenTree::Punct(it) => T::Punct(it),
        TokenTree::Literal(it) => T::Literal(it),
    };
    from.into_iter().map(one).collect()
}
impl Group {
    pub fn of(delimiter: Delimiter, span: Span, raw: Vec<T>) -> T {
        T::Group(Group(
            Parts { delimiter, span, real: OnceCell::new(), raw: raw.into(), opened: OnceCell::new() }.into(),
        ))
    }
    pub fn delimiter(&self) -> Delimiter {
        self.0.delimiter
    }
    pub fn raw(&self) -> &[T] {
        self.0.raw.get_or_init(|| trees(self.real().stream()))
    }
    pub fn opened(&self, open: fn(&[T]) -> Vec<T>) -> &[T] {
        self.0.opened.get_or_init(|| open(self.raw()))
    }
    fn real(&self) -> &proc_macro::Group {
        self.0.real.get_or_init(|| {
            let mut it = proc_macro::Group::new(self.0.delimiter, self.raw().iter().cloned().collect());
            it.set_span(self.0.span);
            it
        })
    }
}
impl T {
    pub fn span(&self) -> Span {
        match self {
            T::Group(it) => it.0.span,
            T::Ident(it) => it.0.span(),
            T::Punct(it) => it.span(),
            T::Literal(it) => it.span(),
        }
    }
    pub fn set_span(&mut self, span: Span) {
        match self {
            T::Group(it) => *self = Group::of(it.delimiter(), span, it.raw().to_vec()),
            T::Ident(it) => it.0.set_span(span),
            T::Punct(it) => it.set_span(span),
            T::Literal(it) => it.set_span(span),
        }
    }
}
impl From<Ident> for T {
    fn from(it: Ident) -> T {
        let text = it.to_string().trim_start_matches("k#").into();
        T::Ident(Word(it, text))
    }
}
impl FromIterator<T> for TokenStream {
    fn from_iter<I: IntoIterator<Item = T>>(all: I) -> Self {
        let one = |t| match t {
            T::Group(it) => TokenTree::from(it.real().clone()),
            T::Ident(it) => it.0.into(),
            T::Punct(it) => it.into(),
            T::Literal(it) => it.into(),
        };
        all.into_iter().map(one).collect()
    }
}
impl fmt::Display for Word {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str(&self.1)
    }
}
impl fmt::Display for T {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            T::Group(it) => it.real().fmt(f),
            T::Ident(it) => it.fmt(f),
            T::Punct(it) => it.fmt(f),
            T::Literal(it) => it.fmt(f),
        }
    }
}
