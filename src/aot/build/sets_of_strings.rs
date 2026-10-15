//! Which values are sets whose keys are strings by their type.

use crate::id::V;
use crate::ir::{Op, Program};

pub(crate) fn sizes_of_sets_of_strings(program: &Program, contents: &[u8], in_parallel: bun_sema::util::InParallel<'_>) -> Vec<Vec<V>> {
    use crate::declared::prim;
    const FUNCTIONS_OF_A_TASK: usize = 256;
    let size = program.strs.find(b"size");
    let mut marked_values = vec![Vec::new(); program.funcs.len()];
    let names_of_collections = [b"Set".as_slice(), b"ReadonlySet"].map(|name| program.strs.find(name));
    let mut tasks: Vec<((&[crate::ir::Func], &[u8]), &mut [Vec<V>])> = program.funcs.chunks(FUNCTIONS_OF_A_TASK).zip(contents.chunks(FUNCTIONS_OF_A_TASK)).zip(marked_values.chunks_mut(FUNCTIONS_OF_A_TASK)).collect();
    bun_sema::util::for_each_mut(&mut tasks, in_parallel, &|((funcs, contents), marked_values)| {
        for (index, func) in funcs.iter().enumerate().filter(|function| contents[function.0] & crate::link::has::CONSTRUCTIONS_OR_SIZES != 0) {
            for block in &func.blocks {
                for &v in &block.ops {
                    if let Some(&Op::PropGet { obj, name }) = func.op(v)
                        && Some(name) == size
                        && let [crate::declared::Part::Global(global, arguments)] = &program.tys.get(func.ty(obj)).parts[..]
                        && names_of_collections.contains(&Some(*global))
                        && let Some(&key) = arguments.first()
                        && let key = program.tys.get(key)
                        && key.prims & prim::STRING != 0
                        && key.prims & !(prim::STRING | prim::NULLISH) == 0
                        && key.parts.is_empty()
                        && key.ints.is_none()
                        && !key.any_object
                        && !key.any_function
                    {
                        marked_values[index].push(v);
                    }
                    if let Some(Op::Construct { .. }) = func.op(v)
                        && let [crate::declared::Part::Global(global, arguments)] = &program.tys.get(func.ty(v)).parts[..]
                        && Some(*global) == names_of_collections[0]
                        && let Some(&key) = arguments.first()
                        && let key = program.tys.get(key)
                        && key.prims & prim::STRING != 0
                        && key.prims & !(prim::STRING | prim::NULLISH) == 0
                        && key.parts.is_empty()
                        && key.ints.is_none()
                        && !key.any_object
                        && !key.any_function
                    {
                        marked_values[index].push(v);
                    }
                }
            }
        }
    });
    marked_values
}
