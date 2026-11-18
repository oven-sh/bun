//! <https://fetch.spec.whatwg.org/#headers-class>

use bun_core::strings;
use bun_jsc::bindgen::{Callable, to_js};
use bun_web::headers::{
    is_cors_safelisted, is_forbidden_request_header, is_token, trim_http_whitespace,
};

use super::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Guard {
    None,
    Request,
    RequestNoCors,
    Response,
    Immutable,
}

type Sorted = Rc<[(Bytes, Bytes)]>;

/// What an object shares with its request or response.
pub(crate) struct Guarded {
    list: RefCell<HeaderList>,
    sorted: RefCell<Option<Sorted>>,
    pub(crate) guard: Guard,
}

pub(super) fn is_header_value(value: &[u8]) -> bool {
    strings::index_of_any(value, b"\0\n\r").is_none()
}

fn is_no_cors_name(name: &[u8]) -> bool {
    [
        &b"accept"[..],
        b"accept-language",
        b"content-language",
        b"content-type",
    ]
    .iter()
    .any(|it| it.eq_ignore_ascii_case(name))
}

fn check_name<'a>(heap: &JsHeap<'a>, name: &[u8]) -> Result<'a> {
    if is_token(name) {
        Ok(())
    } else {
        Err(heap.type_error(format_args!(
            "Invalid header name: '{}'",
            bstr::BStr::new(name)
        )))
    }
}

impl Guarded {
    pub(crate) fn new(list: HeaderList, guard: Guard) -> Rc<Guarded> {
        Rc::new(Guarded {
            list: list.into(),
            sorted: RefCell::default(),
            guard,
        })
    }

    pub(crate) fn list(&self) -> core::cell::Ref<'_, HeaderList> {
        self.list.borrow()
    }

    fn list_mut(&self) -> core::cell::RefMut<'_, HeaderList> {
        self.sorted.take();
        self.list.borrow_mut()
    }

    fn sorted(&self) -> Sorted {
        let sort = || {
            self.list()
                .sorted_and_combined()
                .into_iter()
                .map(|it| (it.0.into(), it.1.into()))
                .collect()
        };
        Rc::clone(self.sorted.borrow_mut().get_or_insert_with(sort))
    }

    /// <https://fetch.spec.whatwg.org/#headers-validate>
    #[optimize(size)]
    fn allows<'a>(&self, heap: &JsHeap<'a>, name: &[u8], value: &[u8]) -> Result<'a, bool> {
        check_name(heap, name)?;
        if !is_header_value(value) {
            return Err(type_error(heap, "Invalid header value"));
        }
        Ok(match self.guard {
            Guard::Immutable => return Err(type_error(heap, "Headers are immutable")),
            Guard::Request => !is_forbidden_request_header(name, value),
            Guard::Response => {
                !name.eq_ignore_ascii_case(b"set-cookie")
                    && !name.eq_ignore_ascii_case(b"set-cookie2")
            }
            Guard::None | Guard::RequestNoCors => true,
        })
    }

    #[optimize(size)]
    pub(super) fn append<'a>(&self, heap: &JsHeap<'a>, name: &[u8], value: &[u8]) -> Result<'a> {
        let value = trim_http_whitespace(value);
        if !self.allows(heap, name, value)? {
            return Ok(());
        }
        if self.guard == Guard::RequestNoCors {
            let combined = self
                .list()
                .get(name)
                .map_or_else(|| value.to_vec(), |it| [&it, &b", "[..], value].concat());
            if !is_no_cors_name(name) || !is_cors_safelisted(name, &combined) {
                return Ok(());
            }
            self.list_mut().delete(b"range");
        }
        self.list_mut().append(name, value);
        Ok(())
    }

    #[optimize(size)]
    pub(super) fn fill<'a>(&self, heap: &JsHeap<'a>, init: &HeadersInit<'a>) -> Result<'a> {
        let append = |name, value| {
            self.append(
                heap,
                &bytes_of(&DomString::from_js_string(heap, name)?),
                &bytes_of(&DomString::from_js_string(heap, value)?),
            )
        };
        match init {
            HeadersInit::Record(record) => record.iter().try_for_each(|it| append(it.0, it.1)),
            HeadersInit::Pairs(pairs) => {
                pairs
                    .iter()
                    .try_for_each(|pair| match (pair.get(0), pair.get(1), pair.len()) {
                        (Some(name), Some(value), 2) => append(name, value),
                        _ => Err(type_error(
                            heap,
                            "A header has to be a pair of a name and a value.",
                        )),
                    })
            }
        }
    }

    pub(super) fn set_type_if_absent<'a>(
        &self,
        heap: &JsHeap<'a>,
        mime: Option<&[u8]>,
    ) -> Result<'a> {
        let mime = mime.filter(|_| !self.list().contains(b"content-type"));
        mime.map_or(Ok(()), |it| self.append(heap, b"Content-Type", it))
    }
}

pub(crate) struct Headers(Rc<Guarded>);

impl Headers {
    pub(super) fn sharing(headers: &Rc<Guarded>) -> Headers {
        Headers(Rc::clone(headers))
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        init: Option<HeadersInit<'a>>,
    ) -> Result<'a, Headers> {
        let headers = Guarded::new(HeaderList::default(), Guard::None);
        init.map_or(Ok(()), |it| headers.fill(heap, &it))?;
        Ok(Headers(headers))
    }

    pub(crate) fn append<'a>(
        &self,
        heap: &JsHeap<'a>,
        name: &DomString,
        value: &DomString,
    ) -> Result<'a> {
        self.0.append(heap, &bytes_of(name), &bytes_of(value))
    }

    #[optimize(size)]
    pub(crate) fn delete<'a>(&self, heap: &JsHeap<'a>, name: &DomString) -> Result<'a> {
        let (name, is_no_cors) = (bytes_of(name), self.0.guard == Guard::RequestNoCors);
        if self.0.allows(heap, &name, b"")?
            && (!is_no_cors || is_no_cors_name(&name) || name.eq_ignore_ascii_case(b"range"))
            && self.0.list().contains(&name)
        {
            self.0.list_mut().retain(|it, _| {
                !it.eq_ignore_ascii_case(&name)
                    && !(is_no_cors && it.eq_ignore_ascii_case(b"range"))
            });
        }
        Ok(())
    }

    pub(crate) fn get<'a>(
        &self,
        heap: &JsHeap<'a>,
        name: &DomString,
    ) -> Result<'a, Option<Str<'a>>> {
        let name = bytes_of(name);
        check_name(heap, &name)?;
        Ok(self
            .0
            .list()
            .get(&name)
            .map(|it| heap.create_latin1_string(&it)))
    }

    pub(crate) fn get_set_cookie<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, JSValue> {
        Ok(
            to_js::array(heap, self.0.list().values(b"set-cookie"), |heap, it| {
                Ok(heap.create_latin1_string(it).as_value())
            })?
            .to_js(),
        )
    }

    pub(crate) fn has<'a>(&self, heap: &JsHeap<'a>, name: &DomString) -> Result<'a, bool> {
        let name = bytes_of(name);
        check_name(heap, &name)?;
        Ok(self.0.list().contains(&name))
    }

    #[optimize(size)]
    pub(crate) fn set<'a>(
        &self,
        heap: &JsHeap<'a>,
        name: &DomString,
        value: &DomString,
    ) -> Result<'a> {
        let (name, value) = (bytes_of(name), bytes_of(value));
        let value = trim_http_whitespace(&value);
        if !self.0.allows(heap, &name, value)? {
            return Ok(());
        }
        if self.0.guard == Guard::RequestNoCors {
            if !is_no_cors_name(&name) || !is_cors_safelisted(&name, value) {
                return Ok(());
            }
            self.0.list_mut().delete(b"range");
        }
        self.0.list_mut().set(&name, value);
        Ok(())
    }

    fn iterate<'a>(&self, heap: &JsHeap<'a>, yields: Yields) -> &'a HeadersIterator {
        js_DomHeadersIterator::create(
            heap,
            HeadersIterator {
                headers: Rc::clone(&self.0),
                yields,
                next: Cell::new(0),
            },
        )
    }

    pub(crate) fn entries<'a>(&self, heap: &JsHeap<'a>) -> &'a HeadersIterator {
        self.iterate(heap, Yields::Entries)
    }

    pub(crate) fn keys<'a>(&self, heap: &JsHeap<'a>) -> &'a HeadersIterator {
        self.iterate(heap, Yields::Keys)
    }

    pub(crate) fn values<'a>(&self, heap: &JsHeap<'a>) -> &'a HeadersIterator {
        self.iterate(heap, Yields::Values)
    }

    #[optimize(size)]
    pub(crate) fn for_each<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        callback: JsLocal<'a, Callable>,
        this: JsLocal<'a>,
    ) -> Result<'a> {
        for at in 0.. {
            let sorted = self.0.sorted();
            let Some((name, value)) = sorted.get(at) else {
                break;
            };
            let arguments = [
                cx.heap.create_latin1_string(value).to_js(),
                cx.heap.create_latin1_string(name).to_js(),
                self.to_js(),
            ];
            callback
                .to_js()
                .call(cx.global(), this.to_js(), &arguments)?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
enum Yields {
    Keys,
    Values,
    Entries,
}

pub(crate) struct HeadersIterator {
    headers: Rc<Guarded>,
    yields: Yields,
    next: Cell<usize>,
}

impl HeadersIterator {
    #[optimize(size)]
    pub(crate) fn next<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, JsLocal<'a, JSObject>> {
        let sorted = self.headers.sorted();
        let Some((name, value)) = sorted.get(self.next.get()) else {
            return Ok(heap.create_iterator_result(None));
        };
        self.next.update(|it| it + 1);
        Ok(heap.create_iterator_result(Some(match self.yields {
            Yields::Keys => heap.create_latin1_string(name).to_js(),
            Yields::Values => heap.create_latin1_string(value).to_js(),
            Yields::Entries => to_js::array(heap, [name, value], |heap, it| {
                Ok(heap.create_latin1_string(it).as_value())
            })?
            .to_js(),
        })))
    }
}
