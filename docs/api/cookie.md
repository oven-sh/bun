# Bun.Cookie & Bun.CookieMap

Bun provides native APIs for working with HTTP cookies through `Bun.Cookie` and `Bun.CookieMap`. These APIs offer fast, easy-to-use methods for parsing, generating, and manipulating cookies in HTTP requests and responses.

## CookieMap class

`Bun.CookieMap` provides a Map-like interface for working with collections of cookies. It implements the `Iterable` interface, allowing you to use it with `for...of` loops and other iteration methods.

```ts
import { CookieMap } from "bun";

// Empty cookie map
const cookies = new Bun.CookieMap();

// From a cookie string
const cookies1 = new Bun.CookieMap("name=value; foo=bar");

// From an object
const cookies2 = new Bun.CookieMap({
  session: "abc123",
  theme: "dark",
});

// From an array of name/value pairs
const cookies3 = new Bun.CookieMap([
  ["session", "abc123"],
  ["theme", "dark"],
]);
```

### In HTTP servers

In Bun's HTTP server, the `cookies` property on the request object is an instance of `CookieMap`:

```ts
const server = Bun.serve({
  port: 3000,
  fetch(req) {
    // Access request cookies
    const cookies = req.cookies;

    // Get a specific cookie
    const sessionCookie = cookies.get("session");
    if (sessionCookie != null) {
      console.log(sessionCookie);
    }

    // Check if a cookie exists
    if (cookies.has("theme")) {
      // ...
    }

    // Set a cookie, it will be automatically applied to the response
    cookies.set("visited", "true");

    return new Response("Hello");
  },
});
```

### Methods

#### `get(name: string): string | null`

Retrieves a cookie by name. Returns `null` if the cookie doesn't exist.

```ts
// Get by name
const cookie = cookies.get("session");

if (cookie != null) {
  console.log(cookie);
}
```

#### `has(name: string): boolean`

Checks if a cookie with the given name exists.

```ts
// Check if cookie exists
if (cookies.has("session")) {
  // Cookie exists
}
```

#### `set(name: string, value: string): void`

#### `set(options: CookieInit): void`

#### `set(cookie: Cookie): void`

Adds or updates a cookie in the map.

```ts
// Set by name and value
cookies.set("session", "abc123");

// Set using options object
cookies.set({
  name: "theme",
  value: "dark",
  maxAge: 3600,
  secure: true,
});

// Set using Cookie instance
const cookie = new Bun.Cookie("visited", "true");
cookies.set(cookie);
```

#### `delete(name: string): void`

#### `delete(options: CookieStoreDeleteOptions): void`

Removes a cookie from the map. When applied to a Response, this adds a cookie with an empty string value and an expiry date in the past.

```ts
// Delete by name
cookies.delete("session");

// Delete with domain/path options
cookies.delete({
  name: "session",
  domain: "example.com",
  path: "/admin",
});
```

#### `toJSON(): Array<[string, string | ReturnType<Cookie["toJSON"]>]>`

Converts the cookie map to a serializable format.

```ts
const json = cookies.toJSON();
```

### Iteration

`CookieMap` provides several methods for iteration:

```ts
// Iterate over [name, cookie] entries
for (const [name, value] of cookies) {
  console.log(`${name}: ${value}`);
}

// Using entries()
for (const [name, value] of cookies.entries()) {
  console.log(`${name}: ${value}`);
}

// Using keys()
for (const name of cookies.keys()) {
  console.log(name);
}

// Using values()
for (const value of cookies.values()) {
  console.log(value);
}

// Using forEach
cookies.forEach((value, name) => {
  console.log(`${name}: ${value}`);
});
```

### Properties

#### `size: number`

Returns the number of cookies in the map.

```ts
console.log(cookies.size); // Number of cookies
```

## Cookie class

`Bun.Cookie` represents an HTTP cookie with its name, value, and attributes.

```ts
import { Cookie } from "bun";

// Create a basic cookie
const cookie = new Bun.Cookie("name", "value");

// Create a cookie with options
const secureSessionCookie = new Bun.Cookie("session", "abc123", {
  domain: "example.com",
  path: "/admin",
  expires: new Date(Date.now() + 86400000), // 1 day
  httpOnly: true,
  secure: true,
  sameSite: "strict",
});

// Parse from a cookie string
const parsedCookie = new Bun.Cookie("name=value; Path=/; HttpOnly");

// Create from an options object
const objCookie = new Bun.Cookie({
  name: "theme",
  value: "dark",
  maxAge: 3600,
  secure: true,
});
```

### Constructors

```ts
// Basic constructor with name/value
new Bun.Cookie(name: string, value: string);

// Constructor with name, value, and options
new Bun.Cookie(name: string, value: string, options: CookieInit);

// Constructor from cookie string
new Bun.Cookie(cookieString: string);

// Constructor from cookie object
new Bun.Cookie(options: CookieInit);
```

### Properties

```ts
cookie.name; // string - Cookie name
cookie.value; // string - Cookie value
cookie.domain; // string | null - Domain scope (null if not specified)
cookie.path; // string - URL path scope (defaults to "/")
cookie.expires; // number | undefined - Expiration timestamp (ms since epoch)
cookie.secure; // boolean - Require HTTPS
cookie.sameSite; // "strict" | "lax" | "none" - SameSite setting
cookie.partitioned; // boolean - Whether the cookie is partitioned (CHIPS)
cookie.maxAge; // number | undefined - Max age in seconds
cookie.httpOnly; // boolean - Accessible only via HTTP (not JavaScript)
```

### Methods

#### `isExpired(): boolean`

Checks if the cookie has expired.

```ts
// Expired cookie (Date in the past)
const expiredCookie = new Bun.Cookie("name", "value", {
  expires: new Date(Date.now() - 1000),
});
console.log(expiredCookie.isExpired()); // true

// Valid cookie (Using maxAge instead of expires)
const validCookie = new Bun.Cookie("name", "value", {
  maxAge: 3600, // 1 hour in seconds
});
console.log(validCookie.isExpired()); // false

// Session cookie (no expiration)
const sessionCookie = new Bun.Cookie("name", "value");
console.log(sessionCookie.isExpired()); // false
```

#### `toString(): string`

Returns a string representation of the cookie suitable for a `Set-Cookie` header.

```ts
const cookie = new Bun.Cookie("session", "abc123", {
  domain: "example.com",
  path: "/admin",
  expires: new Date(Date.now() + 86400000),
  secure: true,
  httpOnly: true,
  sameSite: "strict",
});

console.log(cookie.toString());
// => "session=abc123; Domain=example.com; Path=/admin; Expires=Sun, 19 Mar 2025 15:03:26 GMT; Secure; HttpOnly; SameSite=strict"
```

#### `toJSON(): CookieInit`

Converts the cookie to a plain object suitable for JSON serialization.

```ts
const cookie = new Bun.Cookie("session", "abc123", {
  secure: true,
  httpOnly: true,
});

const json = cookie.toJSON();
// => {
//   name: "session",
//   value: "abc123",
//   path: "/",
//   secure: true,
//   httpOnly: true,
//   sameSite: "lax",
//   partitioned: false
// }

// Works with JSON.stringify
const jsonString = JSON.stringify(cookie);
```

### Static methods

#### `Cookie.parse(cookieString: string): Cookie`

Parses a cookie string into a `Cookie` instance.

```ts
const cookie = Bun.Cookie.parse("name=value; Path=/; Secure; SameSite=Lax");

console.log(cookie.name); // "name"
console.log(cookie.value); // "value"
console.log(cookie.path); // "/"
console.log(cookie.secure); // true
console.log(cookie.sameSite); // "lax"
```

#### `Cookie.from(name: string, value: string, options?: CookieInit): Cookie`

Factory method to create a cookie.

```ts
const cookie = Bun.Cookie.from("session", "abc123", {
  httpOnly: true,
  secure: true,
  maxAge: 3600,
});
```

#### `Cookie.serialize(...cookies: Cookie[]): string`

Combines multiple cookies into a string suitable for a `Cookie` header.

```ts
const cookie1 = new Bun.Cookie("name", "value");
const cookie2 = new Bun.Cookie("foo", "bar");

const cookieStr = Bun.Cookie.serialize(cookie1, cookie2);
// => "name=value; foo=bar"
```

## Types

```ts
interface CookieInit {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: number | Date;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
  httpOnly?: boolean;
  partitioned?: boolean;
  maxAge?: number;
}

interface CookieStoreDeleteOptions {
  name: string;
  domain?: string | null;
  path?: string;
}

interface CookieStoreGetOptions {
  name?: string;
  url?: string;
}

type CookieSameSite = "strict" | "lax" | "none";

class Cookie {
  constructor(name: string, value: string, options?: CookieInit);
  constructor(cookieString: string);
  constructor(cookieObject?: CookieInit);

  name: string;
  value: string;
  domain?: string;
  path: string;
  expires?: number;
  secure: boolean;
  sameSite: CookieSameSite;
  partitioned: boolean;
  maxAge?: number;
  httpOnly: boolean;

  isExpired(): boolean;
  toString(): string;
  toJSON(): CookieInit;

  static parse(cookieString: string): Cookie;
  static from(name: string, value: string, options?: CookieInit): Cookie;
  static serialize(...cookies: Cookie[]): string;
}

class CookieMap implements Iterable<[string, Cookie]> {
  constructor(init?: string[][] | Record<string, string> | string);

  get(name: string): Cookie | null;
  get(options?: CookieStoreGetOptions): Cookie | null;

  getAll(name: string): Cookie[];
  getAll(options?: CookieStoreGetOptions): Cookie[];

  has(name: string, value?: string): boolean;

  set(name: string, value: string): void;
  set(options: CookieInit): void;
  set(cookie: Cookie): void;

  delete(name: string): void;
  delete(options: CookieStoreDeleteOptions): void;

  toString(): string;
  toJSON(): Array<[string, Cookie]>;
  readonly size: number;

  entries(): IterableIterator<[string, Cookie]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<Cookie>;
  forEach(
    callback: (value: Cookie, key: string, map: CookieMap) => void,
    thisArg?: any,
  ): void;

  [Symbol.iterator](): IterableIterator<[string, Cookie]>;
}
```
