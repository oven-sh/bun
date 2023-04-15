export namespace V8 {
  /**
   * @link https://github.com/julianburr/chrome-heap-snapshot-parser/blob/master/index.js#L72
   * @link https://stackoverflow.com/questions/69802133/chrome-heap-snapshot-structure-explanation
   */
  export type HeapSnapshot = {
    snapshot: {
      meta: {
        node_fields: string[];
        node_types: [string[], ...string[]]; // ?
        edge_fields: string[];
        edge_types: [string[], ...string[]]; // ?
        trace_function_info_fields: string[];
        trace_node_fields: string[];
        sample_fields: string[];
        location_fields: string[];
        node_count: number;
        edge_count: number;
        trace_function_count: number;
      };
    };
    nodes: number[];
    edges: number[];
    trace_tree: unknown[];
    trace_function_infos: unknown[];
    samples: unknown[];
    locations: number[];
    strings: string[];
  };
}
