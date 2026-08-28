//! The `note: did you mean "bun run build"?` that follows a name bun could
//! not dispatch: a `bun run <script>`, a `bun <command>`, a `bun pm
//! <subcommand>`. The caller gathers the words it would have accepted;
//! [`closest`] picks the ones the typo is close to, [`note`] prints them.

use std::io::Write as _;

use bun_core::strings;

/// At most this many are suggested.
const LIMIT: usize = 3;

/// The candidates `typed` looks like a typo of, closest first, at most
/// [`LIMIT`]. A candidate is close when its word is within one edit per three
/// typed bytes, at least one, so `tset` finds `test` and `typechek` finds
/// `typecheck`, or when `typed` is a prefix of it, so `build` finds
/// `build:client`. ASCII case does not count as a difference. Of candidates
/// that are the `same` thing (a command and its alias, a word listed twice)
/// only the closest is kept, the first listed on a tie.
pub(crate) fn closest<'a, T>(
    typed: &[u8],
    candidates: &'a [T],
    word: impl Fn(&T) -> &[u8],
    same: impl Fn(&T, &T) -> bool,
) -> Vec<&'a T> {
    let max_distance = (typed.len() / 3).max(1);
    let mut close: Vec<(&T, usize)> = Vec::new();
    for candidate in candidates {
        let word = word(candidate);
        if word.is_empty() {
            continue;
        }
        let distance = strings::edit_distance(typed, word);
        if distance <= max_distance || strings::has_prefix_case_insensitive(word, typed) {
            close.push((candidate, distance));
        }
    }
    // Stable, so on a tie the one listed first stays first.
    close.sort_by_key(|&(_, distance)| distance);
    let mut picked: Vec<&T> = Vec::new();
    for (candidate, _) in close {
        if picked.len() == LIMIT {
            break;
        }
        if !picked.iter().any(|p| same(p, candidate)) {
            picked.push(candidate);
        }
    }
    picked
}

/// Prints `note: did you mean "a", "b" or "c"?` for the commands, each
/// already spelled the way the user should type it (`bun run build`).
/// Prints nothing for an empty list.
pub(crate) fn note(commands: &[Vec<u8>]) {
    if commands.is_empty() {
        return;
    }
    let mut list: Vec<u8> = Vec::new();
    for (i, command) in commands.iter().enumerate() {
        if i > 0 {
            list.extend_from_slice(if i + 1 == commands.len() {
                b" or "
            } else {
                b", "
            });
        }
        let _ = write!(list, "\"{}\"", bstr::BStr::new(command));
    }
    bun_core::note!("did you mean {}?", bstr::BStr::new(&list));
}
