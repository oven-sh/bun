// Id spaces of the records that one checker owns. 0 is nil in every space; no checker id has the open bit.
use crate::tscore::ids::define_id;

define_id!(
    SignatureId,
    CompositeSignatureId,
    TypeMapperId,
    TypeAliasId,
    IndexInfoId,
    TypePredicateId,
    ConditionalRootId,
    InferenceContextId,
    InferenceInfoId,
    InferenceListId,
    InferenceStateId,
    RelaterId,
    ErrorChainId,
    FlowStateId,
);
