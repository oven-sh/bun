var _LineDecoder_buffer: WeakMap<LineDecoder, Uint8Array>, _LineDecoder_carriageReturnIndex: WeakMap<LineDecoder, number | null>;
import { __classPrivateFieldGet, __classPrivateFieldSet } from "../tslib.mjs";
import { concatBytes, decodeUTF8, encodeUTF8 } from "../utils/bytes.mjs";
/**
 * A re-implementation of httpx's `LineDecoder` in Python that handles incrementally
 * reading lines from text.
 *
 * https://github.com/encode/httpx/blob/920333ea98118e9cf617f246905d7b202510941c/httpx/_decoders.py#L258
 */
export class LineDecoder { /*$*/declare static NEWLINE_CHARS: Set<string>; declare static NEWLINE_REGEXP: RegExp;/*$*/
    constructor() {
        _LineDecoder_buffer.set(this, void 0/*$*/ as any/*$*/);
        _LineDecoder_carriageReturnIndex.set(this, void 0/*$*/ as any/*$*/);
        __classPrivateFieldSet(this, _LineDecoder_buffer, new Uint8Array(), "f");
        __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null, "f");
    }
    decode(chunk: Bytes): string[] {
        if (chunk == null) {
            return [];
        }
        const binaryChunk: Uint8Array = chunk instanceof ArrayBuffer ? new Uint8Array(chunk)
            : typeof chunk === 'string' ? encodeUTF8(chunk)
                : chunk;
        __classPrivateFieldSet(this, _LineDecoder_buffer, concatBytes([/*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_buffer, "f")/*$*/ as Uint8Array)/*$*/, binaryChunk]), "f");
        const lines: string[] = [];
        let patternIndex: NewlineIndex | null;
        while ((patternIndex = findNewlineIndex(/*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_buffer, "f")/*$*/ as Uint8Array)/*$*/, /*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f")/*$*/ as number | null)/*$*/)) != null) {
            if (patternIndex.carriage && /*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f")/*$*/ as number | null)/*$*/ == null) {
                // skip until we either get a corresponding `\n`, a new `\r` or nothing
                __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, patternIndex.index, "f");
                continue;
            }
            // we got double \r or \rtext\n
            if (/*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f")/*$*/ as number | null)/*$*/ != null &&
                (patternIndex.index !== /*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f")/*$*/ as number)/*$*/ + 1 || patternIndex.carriage)) {
                lines.push(decodeUTF8(/*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_buffer, "f")/*$*/ as Uint8Array)/*$*/.subarray(0, /*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f")/*$*/ as number)/*$*/ - 1)));
                __classPrivateFieldSet(this, _LineDecoder_buffer, /*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_buffer, "f")/*$*/ as Uint8Array)/*$*/.subarray(/*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f")/*$*/ as number)/*$*/), "f");
                __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null, "f");
                continue;
            }
            const endIndex = /*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f")/*$*/ as number | null)/*$*/ !== null ? patternIndex.preceding - 1 : patternIndex.preceding;
            const line = decodeUTF8(/*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_buffer, "f")/*$*/ as Uint8Array)/*$*/.subarray(0, endIndex));
            lines.push(line);
            __classPrivateFieldSet(this, _LineDecoder_buffer, /*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_buffer, "f")/*$*/ as Uint8Array)/*$*/.subarray(patternIndex.index), "f");
            __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null, "f");
        }
        return lines;
    }
    flush(): string[] {
        if (!/*$*/(/*$*/__classPrivateFieldGet(this, _LineDecoder_buffer, "f")/*$*/ as Uint8Array)/*$*/.length) {
            return [];
        }
        return this.decode('\n');
    }
}
_LineDecoder_buffer = new WeakMap(), _LineDecoder_carriageReturnIndex = new WeakMap();
// prettier-ignore
LineDecoder.NEWLINE_CHARS = new Set(['\n', '\r']);
LineDecoder.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
/**
 * This function searches the buffer for the end patterns, (\r or \n)
 * and returns an object with the index preceding the matched newline and the
 * index after the newline char. `null` is returned if no new line is found.
 *
 * ```ts
 * findNewLineIndex('abc\ndef') -> { preceding: 2, index: 3 }
 * ```
 */
function findNewlineIndex(buffer: Uint8Array, startIndex: number | null): NewlineIndex | null {
    const newline = 0x0a; // \n
    const carriage = 0x0d; // \r
    for (let i = startIndex ?? 0; i < buffer.length; i++) {
        if (buffer[i] === newline) {
            return { preceding: i, index: i + 1, carriage: false };
        }
        if (buffer[i] === carriage) {
            return { preceding: i, index: i + 1, carriage: true };
        }
    }
    return null;
}
export function findDoubleNewlineIndex(buffer: Uint8Array): number {
    // This function searches the buffer for the end patterns (\r\r, \n\n, \r\n\r\n)
    // and returns the index right after the first occurrence of any pattern,
    // or -1 if none of the patterns are found.
    const newline = 0x0a; // \n
    const carriage = 0x0d; // \r
    for (let i = 0; i < buffer.length - 1; i++) {
        if (buffer[i] === newline && buffer[i + 1] === newline) {
            // \n\n
            return i + 2;
        }
        if (buffer[i] === carriage && buffer[i + 1] === carriage) {
            // \r\r
            return i + 2;
        }
        if (buffer[i] === carriage &&
            buffer[i + 1] === newline &&
            i + 3 < buffer.length &&
            buffer[i + 2] === carriage &&
            buffer[i + 3] === newline) {
            // \r\n\r\n
            return i + 4;
        }
    }
    return -1;
}
//# sourceMappingURL=line.mjs.map
/*$*/export type Bytes = string | ArrayBuffer | Uint8Array | null | undefined;
interface NewlineIndex { preceding: number; index: number; carriage: boolean }/*$*/