In Bun, CSV is a first-class citizen alongside JSON, TOML and YAML.

Bun provides built-in support for parsing CSV files both at runtime and when bundling your code.
You can

- parse strings containing CSV data with `Bun.CSV.parse`
- import & require CSV/TSV files as modules at runtime (including hot reloading & watch mode support)
- import & require CSV/TSV files in frontend apps via bun's bundler

## Conformance

Our parser conforms to the deceivingly simple [CSV specification (RFC 4180)](https://www.rfc-editor.org/rfc/rfc4180).
While adding support for many features that are not part of the specification,
that are nonetheless expected by the users coming from other popular CSV parsers:

- full Unicode support (including emojis)
- custom delimiters / quotes (including multi-character)
- dynamic typing (automatic conversion of values to `number`, `boolean` or `null`)
- and more

The parser is implemented in Zig for speed,
but as it parses the entire file content into memory,
it is not recommended for enormous files.

## Runtime API

### `Bun.CSV.parse()`

Parse a string containing CSV data.

```ts
import { CSV } from "bun";

const data = CSV.parse(
  `name,age,email,favourite_animal
John Doe,35,johndoe@example.com,🦔`,
);
console.log(data);
// {
//   data: [
//     {
//       name: 'John Doe',
//       age: '35',
//       email: 'johndoe@example.com',
//       favourite_animal: '🦔'
//     }
//   ],
//   rows: 1,
//   columns: 4
// }
```

By default, the first row is interpreted as the header and used as the keys for the resulting objects.

If you don't have a header row, you can get the contents as a list of lists instead:

```ts
import { CSV } from "bun";

const data = CSV.parse(
  `John Doe,35,johndoe@example.com,🦔
Jane Smith,28,janesmith@example.com,🥟`,
  { header: false },
);
console.log(data);
// {
//   data: [
//     [ 'John Doe', '35', 'johndoe@example.com', '🦔' ],
//     [ 'Jane Smith', '28', 'janesmith@example.com', '🥟' ]
//   ],
//   rows: 2,
//   columns: 4
// }
```

#### Options

To account for different ways of writing CSV files,
we have added few options known from other popular CSV parsers,
which can be passed as the second argument to `Bun.CSV.parse()`.

The default options are:

```ts
const data = CSV.parse(`...csv data...`, {
  header: true,
  delimiter: ",",
  comments: false,
  commentChar: "#",
  trimWhitespace: false,
  dynamicTyping: false,
  quote: '"',
  preview: undefined,
  skipEmptyLines: false,
});
```

Here is a detailed breakdown of each option:

| Option           | Type      | Default     | Description                                                                                                                                                                               |
| ---------------- | --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `header`         | `boolean` | `true`      | Specifies whether the first line contains column headers. When enabled, headers define property keys for each value in a row, creating structured objects instead of simple arrays.       |
| `delimiter`      | `string`  | `,`         | A string that separates columns in each row.                                                                                                                                              |
| `comments`       | `boolean` | `false`     | Instructs the parser to ignore lines representing comments in a CSV file, denoted by `commentChar`.                                                                                       |
| `commentChar`    | `string`  | `#`         | Defines which character(s) identify comment lines in a CSV file.                                                                                                                          |
| `trimWhitespace` | `boolean` | `false`     | Removes leading and trailing whitespace from field names and data values.                                                                                                                 |
| `dynamicTyping`  | `boolean` | `false`     | Automatically converts string values to appropriate JavaScript types (numbers, booleans) during parsing.                                                                                  |
| `quote`          | `string`  | `"`         | Character used to enclose fields containing special characters (like delimiters or newlines). Allows text containing delimiters to be properly parsed without breaking the row structure. |
| `preview`        | `number`  | `undefined` | Parses only the specified number of rows. Useful for quickly analyzing file structure, validating headers, or showing sample data before processing the entire file.                      |
| `skipEmptyLines` | `boolean` | `false`     | Skips empty lines when parsing.                                                                                                                                                           |

All of them are optional.

#### Output

The parser returns an object with the following properties:

- `data`: An array of objects representing the rows of the CSV file.
- `rows`: The number of rows in the CSV file.
- `columns`: The number of columns in the CSV file.
- `errors`: An array of objects representing any errors encountered during parsing. `undefined` if no errors occurred.
- `comments`: An array of objects representing any comments encountered during parsing. Only available if `comments` option is set to `true`.

#### Error Handling

The parser will throw errors on invalid options.
Otherwise, the parsing is very lenient and will rather write encountered errors to the `errors` array,
rather than throwing an error.

```ts
try {
  const parsed = await Bun.CSV.parse(data, {
    preview: -42, //
    delimiter: "",
  });
} catch (e) {
  console.error("Failed to parse CSV:", e.message);
  // Preview value must be a positive integer
  // Delimiter cannot be empty
}
```

#### Dynamic Typing

When `dynamicTyping` option is set to `true`,
the parser will automatically convert string values to appropriate JavaScript types during parsing.

Currently, we do not parse BigInts, hex numbers, or dates
to stay consistent with other CSV parsers with dynamic typing.
This could be added behind an option in the future.

Here is the overview of what is parsed to what type:

| Input text        | dynamicTyping: false         | dynamicTyping: true                                           |
| ----------------- | ---------------------------- | ------------------------------------------------------------- |
| 255               | "255" (string)               | 255 (number)                                                  |
| 9007199254740993  | "9007199254740993" (string)  | "9007199254740993" (string, >2^{53})                          |
| -9007199254740993 | "-9007199254740993" (string) | "-9007199254740993" (string, < -2^{53})                       |
| 0xFF              | "0xFF" (string)              | "0xFF" (string; not a decimal literal)                        |
| FF                | "FF" (string)                | "FF" (string; not a decimal literal)                          |
| 123n              | "123n" (string)              | "123n" (string; not a decimal literal / no BigInt auto-parse) |
| NaN               | "NaN" (string)               | "NaN" (string; not a decimal literal)                         |
| Infinity          | "Infinity" (string)          | "Infinity" (string; not a decimal literal)                    |
| -Infinity         | "-Infinity" (string)         | "-Infinity" (string; not a decimal literal)                   |
| true              | "true" (string)              | true (boolean)                                                |
| false             | "false" (string)             | false (boolean)                                               |
| null              | "null" (string)              | null (null)                                                   |
| (empty string)    | "" (string)                  | "" (string)                                                   |

#### Repeating headers

In case the header row contains repeating column names,
to avoid data loss, the parser appends a number to the column name.

{% codetabs %}

```csv#Input
name,name
John,Doe
Jane,Smith
Liam,Brown
```

```js#Output
import csv_data from "./data.csv";
console.log(csv_data);
// [
//   {
//     name: "John",
//     name_1: "Doe",
//   }, {
//     name: "Jane",
//     name_1: "Smith",
//   }, {
//     name: "Liam",
//     name_1: "Brown",
//   }
// ]
```

{% /codetabs %}

#### Typing the parse result

The output type of `Bun.CSV.parse` depends on two options: `header` and `dynamicTyping`.

`header` decides between `Record<string, T>` and `T[]`,
wehre `T` depends on `dynamicTyping`: `string` if `false` and `string | number | boolean | null` otherwise.

Additionally, the `Bun.CSV.parse` function accepts a generic type parameter that overrides the `T` type.

## Module Import

CSV files can also be imported directly and bun will parse them for you:

```csv
name,age,email,favourite_animal
John Doe,35,johndoe@example.com,🦔
```

```ts
import data from "./data.csv";
console.log(data); // [{ name: "John Doe", age: "35", email: "johndoe@example.com", favourite_animal: "🦔" }];
```

This of course means that hot reloading and other bun features you expect work out of the box.

### Import Options

Bun will automatically parse files with the `.csv` and `.tsv` extensions,
and if you want to import them without headers,
you can use the `csv_no_header` and `tsv_no_header` imports:

```csv
John Doe,35,johndoe@example.com,🦔
```

```ts
import data from "./data.csv" with { type: "csv_no_header" };
console.log(data); // [[ 'John Doe', '35', 'johndoe@example.com', '🦔' ]];
```

### Import Result

The default export of a CSV/TSV module is the parsed data itself,
but the other results of `Bun.CSV.parse` are also available:

```ts
import data, { rows, columns, errors } from "./data.csv";
import { data, rows, columns, errors } from "./data.csv";
```

Both the default export and the named `data` export point to the same object.
Also, `comments` export is available, but is always `undefined` as the comments are disabled by default.

`errors` and `comments` have the following structures:

```ts
{
errors: [
    {
      line: 5,
      message: "Field count mismatch: expected 3, got 2",
    }
  ],
  comments: [
    {
      line: 4,
      text: "this is a comment",
    }
  ]
}
```

The `line` is the line in the original CSV file.

#### Typing imports

Imports are typed same as the `Bun.CSV.parse` function a small caveat:

TypeScript can't use the `with { type: "" }` clause to infer the type,
so if you are using `csv_no_header` or `tsv_no_header` imports,
and you want correct types you can append `?header=false` to the import.

```ts
import data from "./data.csv";
// data is typed as Record<string, string>[]
```

```ts
import data from "./data.csv?header=false" with { type: "csv_no_header" };
// data is typed as string[][]
```

> _Note:_ The `?header=false` does not influence parsing options — it's purely a type hint.

### Bundling

During bundling your CSV files will be parsed at build time,
and included as JS modules in your bundle.

```bash
bun build script.ts --outdir=dist
```

This means:

- Zero runtime CSV parsing overhead in production
- Smaller bundle sizes
- Tree-shaking support for unused results (named imports)

{% codetabs %}

```csv#Input
name,age,email,favourite_animal
John Doe,35,johndoe@example.com,🦔
Jane Smith,28,janesmith@example.com,Cat
Liam Brown,42,Dog
```

```ts#Script
import data, { rows, columns, errors } from "./test.csv";
console.log(data, rows, columns, errors);
```

```js#Output
var rows = 3;
var columns = 4;
var errors = [
  {
    line: 4,
    message: "Field count mismatch: expected 4, got 3"
  }
];
var test_default = [
  {
    name: "John Doe",
    age: "35",
    email: "johndoe@example.com",
    favourite_animal: "\uD83E\uDD94"
  },
  {
    name: "Jane Smith",
    age: "28",
    email: "janesmith@example.com",
    favourite_animal: "Cat"
  },
  {
    name: "Liam Brown",
    age: "42",
    email: "Dog",
    favourite_animal: ""
  }
];

console.log(test_default, rows, columns, errors);
```

{% /codetabs %}

### Dynamic Imports

It is also possible to dynamically import CSV files at runtime.
For example,
you can build a [Single-file executable](/docs/bundler/executables)
that accepts a filename as a command-line argument.

```ts
const filename = Bun.argv[1];
if (!filename?.endsWith(".csv")) throw new Error("Invalid file");
const dynamic_csv = await import(`./${filename}`);
console.log(dynamic_csv);
```

```bash
bun build ./csv-cli.ts --compile --outfile csv_cli
./csv_cli ./test.csv
```
