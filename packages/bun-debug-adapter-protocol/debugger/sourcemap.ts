import { SourceMapConsumer } from "source-map-js";

export type Position = {
  line: number;
  column: number;
};

export interface SourceMap {
  generatedPosition(line?: number, column?: number, url?: string): Position;
  originalPosition(line?: number, column?: number): Position;
}

class ActualSourceMap implements SourceMap {
  #sourceMap: SourceMapConsumer;
  #sources: string[];

  constructor(sourceMap: SourceMapConsumer) {
    this.#sourceMap = sourceMap;
    // @ts-ignore
    this.#sources = sourceMap._absoluteSources;
  }

  #getSource(url?: string): string {
    const sources = this.#sources;
    if (sources.length === 1) {
      return sources[0];
    }
    if (!url) {
      return sources[0] ?? "";
    }
    for (const source of sources) {
      if (url.endsWith(source)) {
        return source;
      }
    }
    return "";
  }

  generatedPosition(line?: number, column?: number, url?: string): Position {
    const source = this.#getSource(url);
    const { line: gline, column: gcolumn } = this.#sourceMap.generatedPositionFor({
      line: line ?? 0,
      column: column ?? 0,
      source,
    });
    console.log(`[sourcemap] -->`, { source, url, line, column }, { gline, gcolumn });
    return {
      line: gline || 0,
      column: gcolumn || 0,
    };
  }

  originalPosition(line?: number, column?: number): Position {
    const { line: oline, column: ocolumn } = this.#sourceMap.originalPositionFor({
      line: line ?? 0,
      column: column ?? 0,
    });
    console.log(`[sourcemap] <--`, { line, column }, { oline, ocolumn });
    return {
      line: oline || 0,
      column: ocolumn || 0,
    };
  }
}

class NoopSourceMap implements SourceMap {
  generatedPosition(line?: number, column?: number, url?: string): Position {
    return {
      line: line ?? 0,
      column: column ?? 0,
    };
  }

  originalPosition(line?: number, column?: number): Position {
    return {
      line: line ?? 0,
      column: column ?? 0,
    };
  }
}

const defaultSourceMap = new NoopSourceMap();

export function SourceMap(url?: string): SourceMap {
  if (!url || !url.startsWith("data:")) {
    return defaultSourceMap;
  }
  try {
    const [_, base64] = url.split(",", 2);
    const decoded = Buffer.from(base64, "base64").toString("utf8");
    const sourceMap = new SourceMapConsumer(JSON.parse(decoded));
    return new ActualSourceMap(sourceMap);
  } catch (error) {
    console.warn("Failed to parse source map URL", url);
  }
  return defaultSourceMap;
}
