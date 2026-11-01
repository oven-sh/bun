// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Assert that terminal block references point to blocks that exist.
//!
//! Corresponds to `src/HIR/AssertTerminalBlocksExist.ts`.

use super::HirFunction;
use super::visitors::for_each_terminal_all_successor;
use crate::diagnostics::{CompilerDiagnostic, cold_invariant};

pub(crate) fn assert_terminal_successors_exist(
    func: &HirFunction,
) -> Result<(), CompilerDiagnostic> {
    let blocks = &func.body.blocks;
    let ids = blocks.keys().map(|id| id.0 as usize + 1).max();
    let mut exists = vec![false; ids.unwrap_or(0)];
    for id in blocks.keys() {
        exists[id.0 as usize] = true;
    }
    for block in blocks.values() {
        let mut unknown = None;
        for_each_terminal_all_successor(&block.terminal, &mut |successor| {
            if !exists.get(successor.0 as usize).is_some_and(|it| *it) {
                unknown = Some(successor);
            }
        });
        if let Some(successor) = unknown {
            return Err(cold_invariant(
                "Terminal successor references unknown block",
                Some(format!(
                    "Block bb{} does not exist for the terminal of bb{}",
                    successor.0, block.id.0
                )),
                block.terminal.loc().copied(),
            )
            .into());
        }
    }
    Ok(())
}
