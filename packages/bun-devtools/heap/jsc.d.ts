export namespace JSC {
  /**
   * @link https://github.com/WebKit/webkit/blob/main/Source/JavaScriptCore/heap/HeapSnapshotBuilder.h
   */
  export type HeapSnapshot = {
    version: 2;
    type: "Inspector";
    nodes: number[];
    nodeClassNames: string[];
    edges: number[];
    edgeTypes: string[];
    edgeNames: string[];
  };
}
