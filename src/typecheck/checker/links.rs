// checker/links.go: the two link stores whose key is an id that upstream assigns on the first request. A store hands out a link where upstream hands out a pointer.
use crate::ast::{NodeId, SymbolId};
use crate::checker::{Checker, ValueSymbolLinks};
use crate::core::{Link, LinkStore};

// nodeLinkStore is a links store keyed by node references. Upstream keeps the values in the pages of a store keyed by ast.GetNodeId: the id of a node is its identity here, so the request assigns nothing and the pages are an allocation detail.
pub type NodeLinkStore<V> = LinkStore<NodeId, V>;

// symbolArenaLinkStore is a links store keyed by symbol references. Upstream keys it by ast.GetSymbolId, which assigns the id of the symbol on the first request: the three accessors below ask for that id before they read the store, so the ids are given in upstream's order.
pub type SymbolArenaLinkStore<V> = LinkStore<SymbolId, V>;

impl<'a> Checker<'a> {
    // symbolArenaLinkStore.Get of the value symbol links
    pub fn value_symbol_links_get(&mut self, symbol: SymbolId) -> Link<ValueSymbolLinks> {
        let _ = self.ast.get_symbol_id(symbol);
        self.value_symbol_links.get(symbol)
    }

    // symbolArenaLinkStore.Has of the value symbol links
    pub fn value_symbol_links_has(&self, symbol: SymbolId) -> bool {
        !self.value_symbol_links_try_get(symbol).is_nil()
    }

    // symbolArenaLinkStore.TryGet of the value symbol links: the nil link for a symbol without links.
    pub fn value_symbol_links_try_get(&self, symbol: SymbolId) -> Link<ValueSymbolLinks> {
        let _ = self.ast.get_symbol_id(symbol);
        self.value_symbol_links.try_get(symbol)
    }
}
