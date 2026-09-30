// printer/namegenerator.go: the scopes of generated names. Upstream reaches the printer through callbacks: here GenerateName returns None where it would call GetTextOfNode or make a unique name.
use crate::ast::{Ast, NodeId};
use crate::printer::emitcontext::{AutoGenerateId, EmitContext};
use bun_collections::HashMap;

#[derive(Default)]
pub struct NameGenerator {
    // Map of generated names for temp and loop variables
    auto_generated_id_to_generated_name: HashMap<AutoGenerateId, Vec<u8>>,
    // The depth of the name generation scopes: a scope holds temp flags and reserved names only for names that are made, which is not ported.
    name_generation_scope: isize,
    private_name_generation_scope: isize,
}

impl NameGenerator {
    pub fn push_scope(&mut self, reuse_temp_variable_scope: bool) {
        self.private_name_generation_scope += 1;
        if !reuse_temp_variable_scope {
            self.name_generation_scope += 1;
        }
    }

    pub fn pop_scope(&mut self, reuse_temp_variable_scope: bool) {
        if self.private_name_generation_scope > 0 {
            self.private_name_generation_scope -= 1;
        }
        if !reuse_temp_variable_scope && self.name_generation_scope > 0 {
            self.name_generation_scope -= 1;
        }
    }

    // Generate the text for a generated identifier or private identifier
    pub fn generate_name(
        &mut self,
        a: Ast<'_>,
        context: &EmitContext,
        name: NodeId,
    ) -> Option<Vec<u8>> {
        if let Some(auto_generate) = context.auto_generate.get(&name) {
            if auto_generate.flags.is_node() {
                // Node names generate unique names based on their original node and are cached based on that node's id.
                a.unhandled::<()>("NameGenerator.generateNameForNodeCached", name);
                return None;
            }
            // Auto, Loop, and Unique names are cached based on their unique autoGenerateId.
            if let Some(auto_generated_name) = self
                .auto_generated_id_to_generated_name
                .get(&auto_generate.id)
            {
                return Some(auto_generated_name.clone());
            }
            a.unhandled::<()>("NameGenerator.makeName", name);
            return None;
        }
        None
    }
}
