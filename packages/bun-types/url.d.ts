/**
 * The `url` module provides utilities for URL resolution and parsing. It can be
 * accessed using:
 *
 * ```js
 * import url from 'url';
 * ```
 * @see [source](https://github.com/nodejs/node/blob/v18.0.0/lib/url.js)
 */
declare module "url" {
  import { ParsedUrlQuery, ParsedUrlQueryInput } from "node:querystring";
  // Input to `url.format`
  interface UrlObject {
    auth?: string | null | undefined;
    hash?: string | null | undefined;
    host?: string | null | undefined;
    hostname?: string | null | undefined;
    href?: string | null | undefined;
    pathname?: string | null | undefined;
    protocol?: string | null | undefined;
    search?: string | null | undefined;
    slashes?: boolean | null | undefined;
    port?: string | number | null | undefined;
    query?: string | null | ParsedUrlQueryInput | undefined;
  }
  // Output of `url.parse`
  interface Url {
    auth: string | null;
    hash: string | null;
    host: string | null;
    hostname: string | null;
    href: string;
    path: string | null;
    pathname: string | null;
    protocol: string | null;
    search: string | null;
    slashes: boolean | null;
    port: string | null;
    query: string | null | ParsedUrlQuery;
  }
  interface UrlWithParsedQuery extends Url {
    query: ParsedUrlQuery;
  }
  interface UrlWithStringQuery extends Url {
    query: string | null;
  }
  /**
   * The `url.parse()` method takes a URL string, parses it, and returns a URL
   * object.
   *
   * A `TypeError` is thrown if `urlString` is not a string.
   *
   * A `URIError` is thrown if the `auth` property is present but cannot be decoded.
   *
   * Use of the legacy `url.parse()` method is discouraged. Users should
   * use the WHATWG `URL` API. Because the `url.parse()` method uses a
   * lenient, non-standard algorithm for parsing URL strings, security
   * issues can be introduced. Specifically, issues with [host name spoofing](https://hackerone.com/reports/678487) and
   * incorrect handling of usernames and passwords have been identified.
   *
   * Deprecation of this API has been shelved for now primarily due to the the
   * inability of the [WHATWG API to parse relative URLs](https://github.com/nodejs/node/issues/12682#issuecomment-1154492373).
   * [Discussions are ongoing](https://github.com/whatwg/url/issues/531) for the  best way to resolve this.
   *
   * @since v0.1.25
   * @param urlString The URL string to parse.
   * @param [parseQueryString=false] If `true`, the `query` property will always be set to an object returned by the {@link querystring} module's `parse()` method. If `false`, the `query` property
   * on the returned URL object will be an unparsed, undecoded string.
   * @param [slashesDenoteHost=false] If `true`, the first token after the literal string `//` and preceding the next `/` will be interpreted as the `host`. For instance, given `//foo/bar`, the
   * result would be `{host: 'foo', pathname: '/bar'}` rather than `{pathname: '//foo/bar'}`.
   */
  function parse(urlString: string): UrlWithStringQuery;
  function parse(
    urlString: string,
    parseQueryString: false | undefined,
    slashesDenoteHost?: boolean,
  ): UrlWithStringQuery;
  function parse(
    urlString: string,
    parseQueryString: true,
    slashesDenoteHost?: boolean,
  ): UrlWithParsedQuery;
  function parse(
    urlString: string,
    parseQueryString: boolean,
    slashesDenoteHost?: boolean,
  ): Url;
  /**
   * The `url.format()` method returns a formatted URL string derived from`urlObject`.
   *
   * ```js
   * const url = require('url');
   * url.format({
   *   protocol: 'https',
   *   hostname: 'example.com',
   *   pathname: '/some/path',
   *   query: {
   *     page: 1,
   *     format: 'json'
   *   }
   * });
   *
   * // => 'https://example.com/some/path?page=1&#x26;format=json'
   * ```
   *
   * If `urlObject` is not an object or a string, `url.format()` will throw a `TypeError`.
   *
   * The formatting process operates as follows:
   *
   * * A new empty string `result` is created.
   * * If `urlObject.protocol` is a string, it is appended as-is to `result`.
   * * Otherwise, if `urlObject.protocol` is not `undefined` and is not a string, an `Error` is thrown.
   * * For all string values of `urlObject.protocol` that _do not end_ with an ASCII
   * colon (`:`) character, the literal string `:` will be appended to `result`.
   * * If either of the following conditions is true, then the literal string `//`will be appended to `result`:
   *    * `urlObject.slashes` property is true;
   *    * `urlObject.protocol` begins with `http`, `https`, `ftp`, `gopher`, or`file`;
   * * If the value of the `urlObject.auth` property is truthy, and either`urlObject.host` or `urlObject.hostname` are not `undefined`, the value of`urlObject.auth` will be coerced into a string
   * and appended to `result`followed by the literal string `@`.
   * * If the `urlObject.host` property is `undefined` then:
   *    * If the `urlObject.hostname` is a string, it is appended to `result`.
   *    * Otherwise, if `urlObject.hostname` is not `undefined` and is not a string,
   *    an `Error` is thrown.
   *    * If the `urlObject.port` property value is truthy, and `urlObject.hostname`is not `undefined`:
   *          * The literal string `:` is appended to `result`, and
   *          * The value of `urlObject.port` is coerced to a string and appended to`result`.
   * * Otherwise, if the `urlObject.host` property value is truthy, the value of`urlObject.host` is coerced to a string and appended to `result`.
   * * If the `urlObject.pathname` property is a string that is not an empty string:
   *    * If the `urlObject.pathname`_does not start_ with an ASCII forward slash
   *    (`/`), then the literal string `'/'` is appended to `result`.
   *    * The value of `urlObject.pathname` is appended to `result`.
   * * Otherwise, if `urlObject.pathname` is not `undefined` and is not a string, an `Error` is thrown.
   * * If the `urlObject.search` property is `undefined` and if the `urlObject.query`property is an `Object`, the literal string `?` is appended to `result`followed by the output of calling the
   * `querystring` module's `stringify()`method passing the value of `urlObject.query`.
   * * Otherwise, if `urlObject.search` is a string:
   *    * If the value of `urlObject.search`_does not start_ with the ASCII question
   *    mark (`?`) character, the literal string `?` is appended to `result`.
   *    * The value of `urlObject.search` is appended to `result`.
   * * Otherwise, if `urlObject.search` is not `undefined` and is not a string, an `Error` is thrown.
   * * If the `urlObject.hash` property is a string:
   *    * If the value of `urlObject.hash`_does not start_ with the ASCII hash (`#`)
   *    character, the literal string `#` is appended to `result`.
   *    * The value of `urlObject.hash` is appended to `result`.
   * * Otherwise, if the `urlObject.hash` property is not `undefined` and is not a
   * string, an `Error` is thrown.
   * * `result` is returned.
   * @since v0.1.25
   * @deprecated Legacy: Use the WHATWG URL API instead.
   * @param urlObject A URL object (as returned by `url.parse()` or constructed otherwise). If a string, it is converted to an object by passing it to `url.parse()`.
   */
  function format(urlObject: URL, options?: URLFormatOptions): string;
  /**
   * The `url.format()` method returns a formatted URL string derived from`urlObject`.
   *
   * ```js
   * const url = require('url');
   * url.format({
   *   protocol: 'https',
   *   hostname: 'example.com',
   *   pathname: '/some/path',
   *   query: {
   *     page: 1,
   *     format: 'json'
   *   }
   * });
   *
   * // => 'https://example.com/some/path?page=1&#x26;format=json'
   * ```
   *
   * If `urlObject` is not an object or a string, `url.format()` will throw a `TypeError`.
   *
   * The formatting process operates as follows:
   *
   * * A new empty string `result` is created.
   * * If `urlObject.protocol` is a string, it is appended as-is to `result`.
   * * Otherwise, if `urlObject.protocol` is not `undefined` and is not a string, an `Error` is thrown.
   * * For all string values of `urlObject.protocol` that _do not end_ with an ASCII
   * colon (`:`) character, the literal string `:` will be appended to `result`.
   * * If either of the following conditions is true, then the literal string `//`will be appended to `result`:
   *    * `urlObject.slashes` property is true;
   *    * `urlObject.protocol` begins with `http`, `https`, `ftp`, `gopher`, or`file`;
   * * If the value of the `urlObject.auth` property is truthy, and either`urlObject.host` or `urlObject.hostname` are not `undefined`, the value of`urlObject.auth` will be coerced into a string
   * and appended to `result`followed by the literal string `@`.
   * * If the `urlObject.host` property is `undefined` then:
   *    * If the `urlObject.hostname` is a string, it is appended to `result`.
   *    * Otherwise, if `urlObject.hostname` is not `undefined` and is not a string,
   *    an `Error` is thrown.
   *    * If the `urlObject.port` property value is truthy, and `urlObject.hostname`is not `undefined`:
   *          * The literal string `:` is appended to `result`, and
   *          * The value of `urlObject.port` is coerced to a string and appended to`result`.
   * * Otherwise, if the `urlObject.host` property value is truthy, the value of`urlObject.host` is coerced to a string and appended to `result`.
   * * If the `urlObject.pathname` property is a string that is not an empty string:
   *    * If the `urlObject.pathname`_does not start_ with an ASCII forward slash
   *    (`/`), then the literal string `'/'` is appended to `result`.
   *    * The value of `urlObject.pathname` is appended to `result`.
   * * Otherwise, if `urlObject.pathname` is not `undefined` and is not a string, an `Error` is thrown.
   * * If the `urlObject.search` property is `undefined` and if the `urlObject.query`property is an `Object`, the literal string `?` is appended to `result`followed by the output of calling the
   * `querystring` module's `stringify()`method passing the value of `urlObject.query`.
   * * Otherwise, if `urlObject.search` is a string:
   *    * If the value of `urlObject.search`_does not start_ with the ASCII question
   *    mark (`?`) character, the literal string `?` is appended to `result`.
   *    * The value of `urlObject.search` is appended to `result`.
   * * Otherwise, if `urlObject.search` is not `undefined` and is not a string, an `Error` is thrown.
   * * If the `urlObject.hash` property is a string:
   *    * If the value of `urlObject.hash`_does not start_ with the ASCII hash (`#`)
   *    character, the literal string `#` is appended to `result`.
   *    * The value of `urlObject.hash` is appended to `result`.
   * * Otherwise, if the `urlObject.hash` property is not `undefined` and is not a
   * string, an `Error` is thrown.
   * * `result` is returned.
   * @since v0.1.25
   * @deprecated Legacy: Use the WHATWG URL API instead.
   * @param urlObject A URL object (as returned by `url.parse()` or constructed otherwise). If a string, it is converted to an object by passing it to `url.parse()`.
   */
  function format(urlObject: UrlObject | string): string;
  /**
   * The `url.resolve()` method resolves a target URL relative to a base URL in a
   * manner similar to that of a web browser resolving an anchor tag.
   *
   * ```js
   * const url = require('url');
   * url.resolve('/one/two/three', 'four');         // '/one/two/four'
   * url.resolve('http://example.com/', '/one');    // 'http://example.com/one'
   * url.resolve('http://example.com/one', '/two'); // 'http://example.com/two'
   * ```
   *
   * To achieve the same result using the WHATWG URL API:
   *
   * ```js
   * function resolve(from, to) {
   *   const resolvedUrl = new URL(to, new URL(from, 'resolve://'));
   *   if (resolvedUrl.protocol === 'resolve:') {
   *     // `from` is a relative URL.
   *     const { pathname, search, hash } = resolvedUrl;
   *     return pathname + search + hash;
   *   }
   *   return resolvedUrl.toString();
   * }
   *
   * resolve('/one/two/three', 'four');         // '/one/two/four'
   * resolve('http://example.com/', '/one');    // 'http://example.com/one'
   * resolve('http://example.com/one', '/two'); // 'http://example.com/two'
   * ```
   * @since v0.1.25
   * @deprecated Legacy: Use the WHATWG URL API instead.
   * @param from The base URL to use if `to` is a relative URL.
   * @param to The target URL to resolve.
   */
  function resolve(from: string, to: string): string;
  /**
   * This function ensures the correct decodings of percent-encoded characters as
   * well as ensuring a cross-platform valid absolute path string.
   *
   * ```js
   * import { fileURLToPath } from 'url';
   *
   * const __filename = fileURLToPath(import.meta.url);
   *
   * new URL('file:///C:/path/').pathname;      // Incorrect: /C:/path/
   * fileURLToPath('file:///C:/path/');         // Correct:   C:\path\ (Windows)
   *
   * new URL('file://nas/foo.txt').pathname;    // Incorrect: /foo.txt
   * fileURLToPath('file://nas/foo.txt');       // Correct:   \\nas\foo.txt (Windows)
   *
   * new URL('file:///你好.txt').pathname;      // Incorrect: /%E4%BD%A0%E5%A5%BD.txt
   * fileURLToPath('file:///你好.txt');         // Correct:   /你好.txt (POSIX)
   *
   * new URL('file:///hello world').pathname;   // Incorrect: /hello%20world
   * fileURLToPath('file:///hello world');      // Correct:   /hello world (POSIX)
   * ```
   * @since v10.12.0
   * @param url The file URL string or URL object to convert to a path.
   * @return The fully-resolved platform-specific Node.js file path.
   */
  function fileURLToPath(url: string | URL): string;
  /**
   * This function ensures that `path` is resolved absolutely, and that the URL
   * control characters are correctly encoded when converting into a File URL.
   *
   * ```js
   * import { pathToFileURL } from 'url';
   *
   * new URL('/foo#1', 'file:');           // Incorrect: file:///foo#1
   * pathToFileURL('/foo#1');              // Correct:   file:///foo%231 (POSIX)
   *
   * new URL('/some/path%.c', 'file:');    // Incorrect: file:///some/path%.c
   * pathToFileURL('/some/path%.c');       // Correct:   file:///some/path%25.c (POSIX)
   * ```
   * @since v10.12.0
   * @param path The path to convert to a File URL.
   * @return The file URL object.
   */
  function pathToFileURL(path: string): URL;
  interface URLFormatOptions {
    auth?: boolean | undefined;
    fragment?: boolean | undefined;
    search?: boolean | undefined;
    unicode?: boolean | undefined;
  }

  /**
   * The URL interface represents an object providing static methods used for
   * creating object URLs.
   */
  interface URL {
    hash: string;
    host: string;
    hostname: string;
    href: string;
    toString(): string;
    readonly origin: string;
    password: string;
    pathname: string;
    port: string;
    protocol: string;
    search: string;
    readonly searchParams: URLSearchParams;
    username: string;
    toJSON(): string;
  }

  interface URLSearchParams {
    /** Appends a specified key/value pair as a new search parameter. */
    append(name: string, value: string): void;
    /** Deletes the given search parameter, and its associated value, from the list of all search parameters. */
    delete(name: string): void;
    /** Returns the first value associated to the given search parameter. */
    get(name: string): string | null;
    /** Returns all the values association with a given search parameter. */
    getAll(name: string): string[];
    /** Returns a Boolean indicating if such a search parameter exists. */
    has(name: string): boolean;
    /** Sets the value associated to a given search parameter to the given value. If there were several values, delete the others. */
    set(name: string, value: string): void;
    sort(): void;
    /** Returns a string containing a query string suitable for use in a URL. Does not include the question mark. */
    toString(): string;
    forEach(
      callbackfn: (value: string, key: string, parent: URLSearchParams) => void,
      thisArg?: any,
    ): void;
  }
}

declare module "node:url" {
  export * from "url";
}
