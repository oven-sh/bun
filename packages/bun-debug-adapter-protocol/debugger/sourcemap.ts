import { SourceMapConsumer } from "source-map-js";

export type Location = {
  line: number;
  column: number;
};

export interface SourceMap {
  generatedLocation(line?: number, column?: number, url?: string): Location;
  originalLocation(line?: number, column?: number): Location;
}

class ActualSourceMap implements SourceMap {
  #sourceMap: SourceMapConsumer;
  #sources: string[];

  constructor(sourceMap: SourceMapConsumer) {
    this.#sourceMap = sourceMap;
    this.#sources = (sourceMap as any)._absoluteSources;
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

  generatedLocation(line?: number, column?: number, url?: string): Location {
    try {
      const source = this.#getSource(url);
      const { line: gline, column: gcolumn } = this.#sourceMap.generatedPositionFor({
        line: lineTo1BasedLine(line),
        column: columnToColumn(column),
        source,
      });
      console.log(`[sourcemap] -->`, { source, url, line, column }, { gline, gcolumn });
      return {
        line: lineTo0BasedLine(gline),
        column: columnToColumn(gcolumn),
      };
    } catch (error) {
      console.warn(error);
      return {
        line: lineToLine(line),
        column: columnToColumn(column),
      };
    }
  }

  originalLocation(line?: number, column?: number): Location {
    try {
      const { line: oline, column: ocolumn } = this.#sourceMap.originalPositionFor({
        line: lineTo1BasedLine(line),
        column: columnToColumn(column),
      });
      console.log(`[sourcemap] <--`, { line, column }, { oline, ocolumn });
      return {
        line: lineTo0BasedLine(oline),
        column: columnToColumn(ocolumn),
      };
    } catch (error) {
      console.warn(error);
      return {
        line: lineToLine(line),
        column: columnToColumn(column),
      };
    }
  }
}

class NoopSourceMap implements SourceMap {
  generatedLocation(line?: number, column?: number, url?: string): Location {
    return {
      line: lineToLine(line),
      column: columnToColumn(column),
    };
  }

  originalLocation(line?: number, column?: number): Location {
    return {
      line: lineToLine(line),
      column: columnToColumn(column),
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
    const decoded = Buffer.from(base64, "base64url").toString("utf8");
    const schema = JSON.parse(decoded);
    // HACK: Bun is sometimes sending invalid mappings
    try {
      schema.mappings = schema.mappings.replace(/[^a-z,;]/gi, "").slice(1);
    } catch {}
    const sourceMap = new SourceMapConsumer(schema);
    return new ActualSourceMap(sourceMap);
  } catch (error) {
    console.warn("Failed to parse source map URL", url);
  }
  return defaultSourceMap;
}

function lineTo1BasedLine(line?: number): number {
  return line ? line + 1 : 1;
}

function lineTo0BasedLine(line?: number): number {
  return line ? line - 1 : 0;
}

function lineToLine(line?: number): number {
  return line ?? 0;
}

function columnToColumn(column?: number): number {
  return column ?? 0;
}
