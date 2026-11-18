//! <https://w3c.github.io/IndexedDB/#cursor-interface>

use super::*;

pub(crate) struct IDBCursor {
    range: KeyRange,
    direction: IDBCursorDirection,
    has_value: bool,
    position: RefCell<Option<Key>>,
    /// <https://w3c.github.io/IndexedDB/#cursor-got-value-flag>
    got_value: Cell<bool>,
    ahead: RefCell<stored::Ahead>,
}

impl IDBCursor {
    pub(super) fn open<'a>(
        heap: &JsHeap<'a>,
        source: &'a IDBSource,
        range: KeyRange,
        direction: IDBCursorDirection,
        has_value: bool,
    ) -> &'a IDBRequest {
        let heap = source.realm(heap);
        let made = IDBCursor {
            range,
            direction,
            has_value,
            position: None.into(),
            got_value: false.into(),
            ahead: RefCell::default(),
        };
        let this: &IDBCursor = if has_value {
            js_IDBCursorWithValue::create(heap, made)
        } else {
            js_IDBCursor::create(heap, made)
        };
        let request = IDBRequest::new(heap, Some(source.to_js()), source.transaction());
        js_IDBCursor::set_source(this, Some(source));
        js_IDBCursor::set_request(this, Some(request));
        js_IDBRequest::set_cursor(request, Some(this));
        this.iterate(1, None);
        request
    }

    fn source(&self) -> &IDBSource {
        js_IDBCursor::source(self).expect("a source")
    }

    fn iterate(&self, count: u32, target: Option<Vec<u8>>) {
        self.got_value.set(false);
        self.source().transaction().enqueue(
            js_IDBCursor::request(self).expect("a request"),
            Operation::Iterate { count, target },
        );
    }

    pub(super) fn move_on<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        transaction: &'a IDBTransaction,
        count: u32,
        target: Option<&[u8]>,
    ) -> Result<'a, JSValue> {
        let source = &self.source().source;
        let direction = source.direction(self.direction);
        let Some(entry) = transaction.stored(cx, |it| {
            it.iterate(
                source.table(),
                &self.range,
                direction,
                self.position.borrow().as_deref(),
                target,
                count,
            )
        })?
        else {
            [
                js_IDBCursor::set_key,
                js_IDBCursor::set_primary_key,
                js_IDBCursor::set_value,
            ]
            .iter()
            .for_each(|set| set(self, JSValue::UNDEFINED));
            self.ahead.take();
            return Ok(JSValue::NULL);
        };
        js_IDBCursor::set_key(self, value_of_key(&cx.heap, &entry)?);
        js_IDBCursor::set_primary_key(self, value_of_key(&cx.heap, source.primary_key(&entry))?);
        if self.has_value {
            let walk = stored::Walk {
                store: source.store.table,
                index: source.index.as_ref().map(|it| it.table),
                range: &self.range,
                direction,
            };
            let mut ahead = self.ahead.take();
            let written = transaction.stored(cx, |it| it.read_at(&walk, &entry, &mut ahead))?;
            let value = JSValue::deserialize(
                written.as_deref().unwrap_or_else(|| ahead.value()),
                cx.global(),
            )?;
            self.ahead.replace(ahead);
            js_IDBCursor::set_value(self, value);
        }
        self.position.replace(Some(entry));
        self.got_value.set(true);
        Ok(self.to_js())
    }

    fn require_readable<'a>(&self, heap: &JsHeap<'a>) -> Result<'a> {
        self.source()
            .transaction()
            .require_active(heap)
            .and_then(|()| self.source().require_existing(heap))
    }

    fn position<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, Key> {
        let refused = || {
            dom_error(
                heap,
                DomError::InvalidStateError,
                "The cursor is being iterated or has iterated past its end.",
            )
        };
        self.position
            .borrow()
            .clone()
            .filter(|_| self.got_value.get())
            .ok_or_else(refused)
    }

    /// Converting the keys can run scripts.
    fn iterate_to<'a>(
        &self,
        heap: &JsHeap<'a>,
        target: Vec<u8>,
        compared: impl FnOnce(&[u8]) -> &[u8],
    ) -> Result<'a> {
        let position = self
            .require_readable(heap)
            .and_then(|()| self.position(heap))?;
        let order = (*target).cmp(compared(&position));
        if !if Direction::from(self.direction).is_forward {
            order.is_gt()
        } else {
            order.is_lt()
        } {
            return Err(dom_error(
                heap,
                DomError::DataError,
                "The parameter is not past this cursor's position.",
            ));
        }
        self.iterate(1, Some(target));
        Ok(())
    }

    pub(crate) fn get_direction(&self) -> IDBCursorDirection {
        self.direction
    }

    pub(crate) fn advance<'a>(&self, heap: &JsHeap<'a>, count: u32) -> Result<'a> {
        if count == 0 {
            return Err(heap.type_error(format_args!(
                "A count argument with value 0 (zero) was supplied, must be greater than 0."
            )));
        }
        self.require_readable(heap)?;
        self.position(heap).map(|_| self.iterate(count, None))
    }

    pub(crate) fn proceed<'a>(&self, cx: Cx<'_, 'a>, key: JsLocal<'a>) -> Result<'a> {
        self.require_readable(&cx.heap)?;
        self.position(&cx.heap)?;
        if key.is_undefined() {
            self.iterate(1, None);
            return Ok(());
        }
        let target = key_of(cx, key)?;
        self.iterate_to(&cx.heap, target, |it| self.source().source.key(it))
    }

    pub(crate) fn continue_primary_key<'a>(
        &self,
        cx: Cx<'_, 'a>,
        key: JsLocal<'a>,
        primary_key: JsLocal<'a>,
    ) -> Result<'a> {
        self.require_readable(&cx.heap)?;
        if self.source().source.index.is_none() || Direction::from(self.direction).skips_duplicates
        {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidAccessError,
                "The source is not an index, or the direction is not 'next' or 'prev'.",
            ));
        }
        self.position(&cx.heap)?;
        let target = [key_of(cx, key)?, key_of(cx, primary_key)?].concat();
        self.iterate_to(&cx.heap, target, |it| it)
    }

    fn effective_key<'a>(&self, heap: &JsHeap<'a>) -> Result<'a, Key> {
        self.source().transaction().require_writable(heap)?;
        self.source().require_existing(heap)?;
        let position = self.position(heap)?;
        match self.has_value {
            true => Ok(self.source().source.primary_key(&position).into()),
            false => Err(dom_error(
                heap,
                DomError::InvalidStateError,
                "The cursor is a key cursor.",
            )),
        }
    }

    pub(crate) fn update<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        value: JsLocal<'a>,
    ) -> Result<'a, &'a IDBRequest> {
        let key = self.effective_key(&cx.heap)?;
        self.source().store_record(
            cx,
            self.to_js(),
            value,
            Some(Key::clone(&key)),
            true,
            Some(&key),
        )
    }

    pub(crate) fn delete<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, &'a IDBRequest> {
        let (range, store) = (
            KeyRange::only(&self.effective_key(heap)?),
            &self.source().source.store,
        );
        Ok(self.source().transaction().request(
            heap,
            self.to_js(),
            Operation::Delete {
                store: store.table,
                range,
                indexes: store.tables_of_indexes(),
            },
        ))
    }
}
