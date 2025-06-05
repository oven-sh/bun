import type { LineRange, MappedPosition } from "source-map-js";
import { SourceMapConsumer } from "source-map-js";

export type LocationRequest = {
  line?: number;
  column?: number;
  url?: string;
};

export type Location = {
  line: number; // 0-based
  column: number; // 0-based
} & (
  | {
      verified: true;
    }
  | {
      verified?: false;
      message?: string;
    }
);

export interface SourceMap {
  /**
   * Converts a location in the original source to a location in the generated source.
   * @param request A request
   */
  generatedLocation(request: LocationRequest): Location;
  /**
   * Converts a location in the generated source to a location in the original source.
   * @param request A request
   */
  originalLocation(request: LocationRequest): Location;
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
    if (!sources.length) {
      return "";
    }
    if (sources.length === 1 || !url) {
      return sources[0];
    }
    for (const source of sources) {
      if (url.endsWith(source)) {
        return source;
      }
    }
    return "";
  }

  generatedLocation(request: LocationRequest): Location {
    const { line, column, url } = request;

    let lineRange: LineRange;
    try {
      const source = this.#getSource(url);
      lineRange = this.#sourceMap.generatedPositionFor({
        line: lineTo1BasedLine(line),
        column: columnToColumn(column),
        source,
      });
    } catch (error) {
      return {
        line: lineToLine(line),
        column: columnToColumn(column),
        verified: false,
        message: unknownToError(error),
      };
    }

    if (!locationIsValid(lineRange)) {
      return {
        line: lineToLine(line),
        column: columnToColumn(column),
        verified: false,
      };
    }

    const { line: gline, column: gcolumn } = lineRange;
    return {
      line: lineTo0BasedLine(gline),
      column: columnToColumn(gcolumn),
      verified: true,
    };
  }

  originalLocation(request: LocationRequest): Location {
    const { line, column } = request;

    let mappedPosition: MappedPosition;
    try {
      mappedPosition = this.#sourceMap.originalPositionFor({
        line: lineTo1BasedLine(line),
        column: columnToColumn(column),
      });
    } catch (error) {
      return {
        line: lineToLine(line),
        column: columnToColumn(column),
        verified: false,
        message: unknownToError(error),
      };
    }

    if (!locationIsValid(mappedPosition)) {
      return {
        line: lineToLine(line),
        column: columnToColumn(column),
        verified: false,
      };
    }

    const { line: oline, column: ocolumn } = mappedPosition;
    return {
      line: lineTo0BasedLine(oline),
      column: columnToColumn(ocolumn),
      verified: true,
    };
  }
}

class NoopSourceMap implements SourceMap {
  generatedLocation(request: LocationRequest): Location {
    const { line, column } = request;
    return {
      line: lineToLine(line),
      column: columnToColumn(column),
      verified: true,
    };
  }

  originalLocation(request: LocationRequest): Location {
    const { line, column } = request;
    return {
      line: lineToLine(line),
      column: columnToColumn(column),
      verified: true,
    };
  }
}

const defaultSourceMap = new NoopSourceMap();

export function SourceMap(url?: string): SourceMap {
  if (!url) {
    return defaultSourceMap;
  }
  if (!url.startsWith("data:")) {
    const match = url.match(/\/\/[#@]\s*sourceMappingURL=(.*)$/m);
    if (!match) {
      return defaultSourceMap;
    }
    const [_, sourceMapUrl] = match;
    url = sourceMapUrl;
  }
  try {
    const [_, base64] = url.split(",", 2);
    const decoded = Buffer.from(base64, "base64url").toString("utf8");
    const schema = JSON.parse(decoded);
    const sourceMap = new SourceMapConsumer(schema);
    return new ActualSourceMap(sourceMap);
  } catch (error) {
    console.warn("Failed to parse source map URL", url);
  }
  return defaultSourceMap;
}

function lineTo1BasedLine(line?: number): number {
  return numberIsValid(line) ? line + 1 : 1;
}

function lineTo0BasedLine(line?: number): number {
  return numberIsValid(line) ? line - 1 : 0;
}

function lineToLine(line?: number): number {
  return numberIsValid(line) ? line : 0;
}

function columnToColumn(column?: number): number {
  return numberIsValid(column) ? column : 0;
}

function locationIsValid(location: Location): location is Location {
  const { line, column } = location;
  return numberIsValid(line) && numberIsValid(column);
}

function numberIsValid(number?: number): number is number {
  return typeof number === "number" && isFinite(number) && number >= 0;
}

function unknownToError(error: unknown): string {
  if (error instanceof Error) {
    const { message } = error;
    return message;
  }
  return String(error);
}
