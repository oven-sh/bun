use bun_engine_text::Text;

use crate::Error;
use crate::parser::NameId;
use crate::tree::{Group, Groups, Node, NodeId, Tree};

/// The names of groups, in the order of the first group that has each.
#[derive(Default)]
pub struct GroupNames {
    units: Vec<u16>,
    groups: Vec<Group>,
    /// In `units` and in `groups`.
    ends: Vec<(u32, u32)>,
    /// The positions in the order of the names' text, if there are many.
    sorted: Vec<u16>,
}

const NAMES_COMPARED_IN_TURN: usize = 8;

impl GroupNames {
    pub const NONE: &GroupNames = &GroupNames {
        units: Vec::new(),
        groups: Vec::new(),
        ends: Vec::new(),
        sorted: Vec::new(),
    };

    #[inline]
    pub fn len(&self) -> usize {
        self.ends.len()
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.ends.is_empty()
    }

    fn get(&self, position: usize) -> (Text<'_>, &[Group]) {
        let start = position.checked_sub(1).map_or((0, 0), |it| self.ends[it]);
        let end = self.ends[position];
        (
            Text::Utf16(&self.units[start.0 as usize..end.0 as usize]),
            &self.groups[start.1 as usize..end.1 as usize],
        )
    }

    /// Each with its groups, ascending. At most one of them takes part in a match.
    pub fn iter(&self) -> impl ExactSizeIterator<Item = (Text<'_>, &[Group])> {
        (0..self.len()).map(|position| self.get(position))
    }

    pub fn find(&self, name: Text<'_>) -> Option<&[Group]> {
        if self.sorted.is_empty() {
            return self.iter().find(|it| it.0 == name).map(|it| it.1);
        }
        let get = |position: u16| self.get(position.into());
        let found = self.sorted.binary_search_by(|&it| get(it).0.cmp(&name));
        found.ok().map(|index| get(self.sorted[index]).1)
    }
}

#[derive(Default)]
pub(super) struct NamedGroups {
    names: GroupNames,
    /// For each name that a group has by now, its position among `names`.
    positions: Vec<Option<u16>>,
    /// With the position of the name.
    groups: Vec<(u16, Group)>,
    references: Vec<(NodeId, NameId, Groups)>,
}

impl NamedGroups {
    pub(super) fn add_group(
        &mut self,
        group: Group,
        name: NameId,
        text: Text<'_>,
    ) -> Result<(), Error> {
        let name = name as usize;
        if name >= self.positions.len() {
            self.positions.resize(name + 1, None);
        }
        let position = match self.positions[name] {
            Some(position) => position,
            None => {
                let GroupNames { units, ends, .. } = &mut self.names;
                units
                    .try_reserve(text.len())
                    .map_err(|_| Error::OutOfMemory)?;
                units.extend(text.code_units());
                ends.push((units.len() as u32, 0));
                *self.positions[name].insert(ends.len() as u16 - 1)
            }
        };
        self.groups.push((position, group));
        Ok(())
    }

    pub(super) fn add_reference(
        &mut self,
        node: NodeId,
        name: NameId,
        candidates: Groups,
    ) -> Result<(), Error> {
        self.references
            .try_reserve(1)
            .map_err(|_| Error::OutOfMemory)?;
        self.references.push((node, name, candidates));
        Ok(())
    }

    #[inline]
    pub(super) fn forget_references_from(&mut self, first_node: usize) {
        let is_gone = |&mut (node, ..): &mut (NodeId, _, _)| node.index() >= first_node;
        while self.references.pop_if(is_gone).is_some() {}
    }

    /// Every name has a group.
    pub(super) fn resolve(mut self, tree: &mut Tree) -> Result<GroupNames, Error> {
        let mut names = self.names;
        self.groups.sort_unstable();
        for (index, &(position, _)) in self.groups.iter().enumerate() {
            names.ends[usize::from(position)].1 = index as u32 + 1;
        }
        names.groups = self.groups.iter().map(|&(_, group)| group).collect();
        if names.len() > NAMES_COMPARED_IN_TURN {
            let mut sorted: Vec<u16> = (0..names.len() as u16).collect();
            sorted.sort_unstable_by_key(|&position| names.get(position.into()).0);
            names.sorted = sorted;
        }
        if self.references.is_empty() {
            return Ok(names);
        }
        let all = tree.add_groups(&names.groups)?;
        for (node, name, candidates) in self.references {
            let (Some(&Some(position)), Node::BackReference { ignore_case, .. }) =
                (self.positions.get(name as usize), tree[node])
            else {
                return Err(Error::InvalidNamedReference);
            };
            let before = |group| self.groups.partition_point(|&it| it < (position, group));
            let groups = all.slice(before(candidates.first)..before(candidates.end));
            tree.replace(
                node,
                Node::BackReference {
                    groups,
                    ignore_case,
                },
            );
        }
        Ok(names)
    }
}
