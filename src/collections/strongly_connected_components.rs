/// Tarjan's algorithm, without recursion. Returns each node's component number, and each component's nodes in ascending
/// order. A component has a higher number than every component it has an edge to.
pub fn strongly_connected_components(edges: &[Vec<u32>]) -> (Vec<u32>, Vec<Vec<usize>>) {
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
