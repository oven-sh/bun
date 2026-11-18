//! Objects, their shapes and their properties.

mod accessor;
mod array;
mod array_creation;
mod class;
mod condition;
mod define;
mod descriptor;
mod element_moves;
mod element_search;
mod element_writer;
mod elements;
mod final_object;
mod get;
mod immutable_array;
mod indexing_mode;
mod inherited;
mod integrity;
mod js_object;
mod lazy;
mod own_keys;
mod plain_range;
mod property_key;
mod property_name_list;
mod property_offset;
mod property_table;
mod put;
mod quiet_elements;
mod reify;
mod shape;
mod shape_cache;
mod slot;
mod small;
mod sparse_elements;
mod special_property_cache;
mod static_table;
mod storage;
mod transition_table;
mod visit;

pub(crate) use accessor::as_seen_by_scripts;
pub use accessor::{CustomGetterSetter, GetterSetter};
pub use array::{JsArray, JsArrayInit};
pub use class::{AsciiLiteral, Class, ClassOps};
pub use condition::{
    ConditionKind, ConditionSet, PropertyCondition, Watchability, watch_condition,
};
pub use define::validate_property_descriptor;
pub use descriptor::PropertyDescriptor;
pub use element_search::{Direction, SearchResult};
pub use element_writer::{ElementWriter, HoleMode};
pub use elements::{Elements, PutDirectIndexMode};
pub use final_object::JsFinalObject;
pub use immutable_array::ImmutableArray;
pub use indexing_mode::{ElementKind, IndexingMode};
pub use inherited::Inherited;
pub use integrity::IntegrityLevel;
pub use js_object::{JsDestructibleObject, JsObject, JsObjectInit};
pub use lazy::{LazyClass, LazyField};
pub use own_keys::OwnKeys;
pub(crate) use plain_range::PlainRange;
pub use property_key::PropertyKey;
pub use property_name_list::{DontEnumMode, PropertyNameList, PropertyNameMode};
pub use property_offset::{Attributes, PropertyOffset};
pub use property_table::PropertyEntry;
pub use reify::function_name;
pub use shape::{
    CachedNames, Properties, Shape, ShapeFlags, ShapeId, ShapeInit, ShapeRareData, ShapeSpec,
};
pub(crate) use shape_cache::ShapeCache;
pub use slot::{
    CustomGetter, CustomSetter, DeleteKind, DeletePropertySlot, InternalMethod, PropertySlot,
    PutContext, PutKind, PutPropertySlot,
};
pub(crate) use small::SnugShape;
pub use sparse_elements::{SparseElements, SparseEntry};
pub use special_property_cache::SpecialProperty;
pub use static_table::{
    BuiltinGenerator, PropertyCallback, PropertyMaker, StaticIndex, StaticProperty, StaticTable,
};
pub use storage::Storage;
pub use transition_table::TransitionKind;
pub(crate) use visit::{destroy_by_class_field, destroy_by_shape, visit_common_cell};
