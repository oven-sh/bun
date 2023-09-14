interface V8HeapSnapshot {
    snapshot: {
        meta: {
            node_fields: string[],
            node_types: [string[], ...string[]],
            edge_fields: string[],
            edge_types: [string[], ...string[]],
            trace_function_info_fields: string[],
            trace_node_fields: string[],
            sample_fields: string[],
            location_fields: string[]
        },
        node_count: number,
        edge_count: number,
        trace_function_count: number
    },
    nodes: number[],
    edges: number[],
    trace_function_infos: unknown[],
    trace_tree: unknown[],
    samples: unknown[],
    locations: number[],
    strings: string[]
}
