//! Names go before `:parameters` and those before `*`, in each segment. Derives from uWebSockets (LICENSE.md).
#![forbid(unsafe_code)]

use bun_collections::smallvec::SmallVec;
use bun_core::bounded_array::BoundedArray;
use bun_core::strings::ByteSet;

use crate::Method::{Method, Set as Methods};

/// The rest of a pattern or a path is ignored.
const MAX_SEGMENTS: usize = 100;

/// Small, because the GC scans it with its unused slots while the handler runs.
pub type Parameters<'a> = SmallVec<[&'a [u8]; 8]>;

pub static NOT_SLASH: ByteSet = ByteSet::new(&[0..=b'.', b'0'..=0xff]);

/// The first and the last four bytes.
fn sort_key(name: &[u8]) -> u64 {
    match name.first_chunk().zip(name.last_chunk()) {
        Some((&first, &last)) => {
            u64::from(u32::from_ne_bytes(first)) << 32 | u64::from(u32::from_ne_bytes(last))
        }
        None => (name.iter()).fold(0, |key, &byte| key << 8 | u64::from(byte)),
    }
}

struct Route {
    /// Of a wildcard.
    name: Box<[u8]>,
    methods: Methods,
    is_for_any: bool,
    handler: usize,
}

#[derive(Default)]
struct Node {
    name: Box<[u8]>,
    /// Of the routes here and below.
    methods: Methods,
    /// By `sort_key`, then by name.
    names: Vec<(u64, Box<Node>)>,
    parameter: Option<Box<Node>>,
    wildcards: Vec<Route>,
    /// For a path that ends here.
    routes: Vec<Route>,
}

struct Search<'s, 'a> {
    method: Methods,
    skip: usize,
    parameters: &'s mut Parameters<'a>,
    segment_lens: BoundedArray<usize, MAX_SEGMENTS>,
}

impl Search<'_, '_> {
    fn pick<'r>(&mut self, routes: &'r [Route]) -> Option<&'r Route> {
        for route in routes {
            if route.methods.is_superset(self.method) {
                if self.skip == 0 {
                    return Some(route);
                }
                self.skip -= 1;
            }
        }
        None
    }
}

/// The newest goes last, but the route of a method is followed by the one of that name for any.
fn set(routes: &mut Vec<Route>, name: &[u8], method: Option<Method>, handler: usize) {
    let route = |methods| Route {
        name: name.into(),
        methods,
        is_for_any: method.is_none(),
        handler,
    };
    routes.reserve_exact(1);
    let Some(method) = method else {
        routes.retain(|other| !other.is_for_any || *other.name != *name);
        let mut rest = Methods::all();
        for index in (0..routes.len()).rev() {
            if *routes[index].name == *name {
                rest -= routes[index].methods;
                routes.insert(index + 1, route(routes[index].methods));
            }
        }
        return routes.push(route(rest));
    };
    let covers = |other: &Route| other.methods.contains(method) && *other.name == *name;
    routes.retain(|other| other.is_for_any || !covers(other));
    let index = routes.iter().position(covers).unwrap_or(routes.len());
    routes.insert(index, route(method.into()));
}

impl Node {
    fn named(&self, name: &[u8]) -> Option<&Node> {
        let key = sort_key(name);
        let first = self.names.partition_point(|&(other, _)| other < key);
        let (_, node) = self.names.get(first).filter(|(other, _)| *other == key)?;
        // The key has all of a short name.
        if node.name.len() == name.len() && (name.len() <= 8 || *node.name == *name) {
            return Some(node);
        }
        Some(&self.names[self.index_of(key, name).ok()?].1)
    }

    fn index_of(&self, key: u64, name: &[u8]) -> Result<usize, usize> {
        (self.names).binary_search_by_key(&(key, name), |(key, node)| (*key, &node.name))
    }

    fn add(&mut self, method: Option<Method>, mut pattern: &[u8], handler: usize) {
        let methods = method.map_or(Methods::all(), Methods::only);
        let mut node = self;
        node.methods |= methods;
        for depth in 1..=MAX_SEGMENTS {
            let [_, rest @ ..] = pattern else { break };
            let segment;
            (segment, pattern) = rest.split_at(NOT_SLASH.prefix_len(rest));
            node = match segment {
                [b'*', ..] if !pattern.is_empty() && depth < MAX_SEGMENTS => return,
                [b'*', ..] => return set(&mut node.wildcards, segment, method, handler),
                [b':', ..] => node.parameter.get_or_insert_default(),
                _ => {
                    let key = sort_key(segment);
                    let index = node.index_of(key, segment).unwrap_or_else(|index| {
                        let mut child = Box::<Node>::default();
                        child.name = segment.into();
                        node.names.insert(index, (key, child));
                        index
                    });
                    &mut node.names[index].1
                }
            };
            node.methods |= methods;
        }
        set(&mut node.routes, b"", method, handler);
    }

    #[inline]
    fn find<'a>(
        &self,
        path: &'a [u8],
        depth: usize,
        search: &mut Search<'_, 'a>,
    ) -> Option<&Route> {
        match (path, depth) {
            _ if !self.methods.is_superset(search.method) => None,
            ([_, path @ ..], ..MAX_SEGMENTS) => self.find_below(path, depth, search),
            _ => search.pick(&self.routes),
        }
    }

    fn find_below<'a>(
        &self,
        path: &'a [u8],
        depth: usize,
        search: &mut Search<'_, 'a>,
    ) -> Option<&Route> {
        if !self.names.is_empty() || self.parameter.is_some() {
            let len = search.segment_lens.get(depth).copied().unwrap_or_else(|| {
                let len = NOT_SLASH.prefix_len(path);
                search.segment_lens.append_assume_capacity(len);
                len
            });
            let (segment, rest) = path.split_at(len);
            if let Some(node) = self.named(segment)
                && let found @ Some(_) = node.find(rest, depth + 1, search)
            {
                return found;
            }
            if let Some(node) = &self.parameter
                && !segment.is_empty()
            {
                search.parameters.push(segment);
                if let found @ Some(_) = node.find(rest, depth + 1, search) {
                    return found;
                }
                search.parameters.pop();
            }
        }
        search.pick(&self.wildcards)
    }
}

pub struct Router<H> {
    root: Node,
    handlers: Vec<H>,
}

impl<H> Default for Router<H> {
    fn default() -> Self {
        Self {
            root: Node::default(),
            handlers: Vec::new(),
        }
    }
}

impl<H: Copy> Router<H> {
    /// For any method if it is `None`. It replaces a route of the same shape.
    pub fn add(&mut self, method: Option<Method>, pattern: &[u8], handler: H) {
        self.root.add(method, pattern, self.handlers.len());
        self.handlers.push(handler);
    }

    pub fn is_empty(&self) -> bool {
        self.handlers.is_empty()
    }

    /// The best handler after the first `skip`.
    // Inlined, `Search` stays on the stack for the GC to scan too.
    #[inline(never)]
    pub fn find<'a>(
        &self,
        method: Method,
        path: &'a [u8],
        skip: usize,
        parameters: &mut Parameters<'a>,
    ) -> Option<H> {
        parameters.clear();
        let mut search = Search {
            method: Methods::only(method),
            skip,
            parameters,
            segment_lens: BoundedArray::new(),
        };
        let route = self.root.find(path, 0, &mut search)?;
        Some(self.handlers[route.handler])
    }
}
