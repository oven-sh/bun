// checker/flow.go 50-66: the pool of flow states. The methods that take `f *FlowState` take the id.
use crate::checker::c01_data::FlowState;
use crate::checker::checker::Checker;
use crate::tscore::ids::FlowStateId;

impl Checker<'_> {
    pub fn get_flow_state(&mut self) -> FlowStateId {
        let mut f = self.free_flow_state;
        if f.is_nil() {
            f = self.flow_states.alloc(FlowState::default());
        }
        self.free_flow_state = self.flow_states[f].next;
        f
    }

    pub fn put_flow_state(&mut self, f: FlowStateId) {
        let next = self.free_flow_state;
        let state = &mut self.flow_states[f];
        // `*f = FlowState{...}`: every field is zero again; reduce_labels keeps its storage.
        state.reference = Default::default();
        state.declared_type = Default::default();
        state.initial_type = Default::default();
        state.flow_container = Default::default();
        state.ref_key = Default::default();
        state.depth = 0;
        state.shared_flow_start = 0;
        state.reduce_labels.clear();
        state.next = next;
        self.free_flow_state = f;
    }
}
