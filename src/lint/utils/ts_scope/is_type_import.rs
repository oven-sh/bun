//! typescript-eslint's `util/isTypeImport.ts`.

use crate::ast::Flags;
use crate::semantic::Declaration;

/// typescript-eslint's `isTypeImport`: `import type { A }`, `import { type A }`,
/// `import type A = require("a")`.
pub fn is_type_import(definition: Declaration) -> bool {
    match definition {
        Declaration::ImportDefault(import) | Declaration::ImportNamespace(import) => {
            import.is_type_only()
        }
        Declaration::ImportSpec(specifier) => {
            specifier.is_type_only() || specifier.import().is_type_only()
        }
        Declaration::ImportEquals(import) => import.flags().contains(Flags::TYPE_ONLY),
        _ => false,
    }
}
