//! The strongly connected components of the import graph, and their levels. Computed once, at the
//! end of loading.
//!
//! The link step resolves exports and aliases component by component, level by level. Everything
//! here is a function of the graph and of program order alone.

use crate::program::FileId;

pub struct Component {
    /// In program order.
    pub files: Vec<FileId>,
    /// 0 if it imports nothing outside itself. Otherwise one more than the highest level of a component it imports.
    pub level: u32,
}

pub struct Components {
    /// In program order of their first files.
    pub all: Vec<Component>,
    /// For each `FileId` the index of its component in `all`. `u32::MAX`: the file is not in the program.
    pub of_file: Vec<u32>,
}

impl Components {
    /// `order`: the files of the program, in program order. `imports(file)`: the files that `file` refers to, in any order, with
    /// repetitions.
    pub fn new(order: &[FileId], imports: &dyn Fn(FileId) -> Vec<FileId>) -> Components {
        // A node is a position in `order`.
        let files = order.iter().map(|file| file.idx() + 1).max().unwrap_or(0);
        let mut node_of = vec![u32::MAX; files];
        for (node, file) in order.iter().enumerate() {
            node_of[file.idx()] = node as u32;
        }
        let edges_of = |&file: &FileId| {
            let imports = imports(file).into_iter();
            let nodes = imports.filter_map(|imported| node_of.get(imported.idx()).copied());
            let mut edges: Vec<u32> = nodes.filter(|&node| node != u32::MAX).collect();
            edges.sort_unstable();
            edges.dedup();
            edges
        };
        let edges: Vec<Vec<u32>> = order.iter().map(edges_of).collect();
        // Numbered by the traversal: a component has a higher number than every component it imports.
        let (number_of, numbered) = strongly_connected_components(&edges);
        let mut levels = vec![0u32; numbered.len()];
        for (number, nodes) in numbered.iter().enumerate() {
            for &imported in nodes.iter().flat_map(|&node| &edges[node]) {
                let imported = number_of[imported as usize] as usize;
                if imported != number {
                    levels[number] = levels[number].max(levels[imported] + 1);
                }
            }
        }
        let mut in_program_order: Vec<usize> = (0..numbered.len()).collect();
        in_program_order.sort_unstable_by_key(|&number| numbered[number][0]);
        let mut index_of = vec![0u32; numbered.len()];
        for (index, &number) in in_program_order.iter().enumerate() {
            index_of[number] = index as u32;
        }
        let component = |&number: &usize| Component {
            files: numbered[number].iter().map(|&node| order[node]).collect(),
            level: levels[number],
        };
        let of_node = |&node: &u32| match number_of.get(node as usize) {
            Some(&number) => index_of[number as usize],
            None => u32::MAX,
        };
        Components {
            all: in_program_order.iter().map(component).collect(),
            of_file: node_of.iter().map(of_node).collect(),
        }
    }

    /// The indices in `all` of the components of level 0, of level 1, .. Within a level in program order.
    pub fn by_level(&self) -> Vec<Vec<u32>> {
        let levels = self.all.iter().map(|it| it.level as usize + 1).max();
        let mut by_level: Vec<Vec<u32>> = vec![Vec::new(); levels.unwrap_or(0)];
        for (index, component) in self.all.iter().enumerate() {
            by_level[component.level as usize].push(index as u32);
        }
        by_level
    }
}

/// Tarjan's algorithm, without recursion. For each node the number of its component, and the nodes of each component in ascending
/// order. A component has a higher number than every component it has an edge to.
fn strongly_connected_components(edges: &[Vec<u32>]) -> (Vec<u32>, Vec<Vec<usize>>) {
    const NOT_VISITED: u32 = u32::MAX;
    #[derive(Clone)]
    struct Node {
        index: u32,
        lowlink: u32,
        is_on_stack: bool,
    }
    let not_visited = Node {
        index: NOT_VISITED,
        lowlink: 0,
        is_on_stack: false,
    };
    let mut nodes = vec![not_visited; edges.len()];
    let mut component_of = vec![0u32; edges.len()];
    let mut components: Vec<Vec<usize>> = Vec::new();
    let (mut stack, mut visited) = (Vec::new(), 0u32);
    // A node in progress, and how many of its edges have been followed.
    let mut in_progress: Vec<(usize, usize)> = Vec::new();
    for root in 0..edges.len() {
        if nodes[root].index != NOT_VISITED {
            continue;
        }
        in_progress.push((root, 0));
        while let Some(&(node, followed)) = in_progress.last() {
            if followed == 0 {
                (nodes[node].index, nodes[node].lowlink) = (visited, visited);
                nodes[node].is_on_stack = true;
                visited += 1;
                stack.push(node);
            }
            if let Some(&next) = edges[node].get(followed) {
                in_progress.last_mut().unwrap().1 += 1;
                let next = next as usize;
                if nodes[next].index == NOT_VISITED {
                    in_progress.push((next, 0));
                } else if nodes[next].is_on_stack {
                    nodes[node].lowlink = nodes[node].lowlink.min(nodes[next].index);
                }
                continue;
            }
            in_progress.pop();
            if let Some(&(parent, _)) = in_progress.last() {
                nodes[parent].lowlink = nodes[parent].lowlink.min(nodes[node].lowlink);
            }
            if nodes[node].lowlink == nodes[node].index {
                let from = stack.iter().rposition(|&it| it == node).unwrap();
                let mut component = stack.split_off(from);
                for &member in &component {
                    nodes[member].is_on_stack = false;
                    component_of[member] = components.len() as u32;
                }
                component.sort_unstable();
                components.push(component);
            }
        }
    }
    (component_of, components)
}
