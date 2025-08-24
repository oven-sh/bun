---
name: Import a YAML file
---

Bun natively supports `.yaml` and `.yml` imports.

```yaml#config.yaml
database:
  host: localhost
  port: 5432
  name: myapp

server:
  port: 3000
  timeout: 30

features:
  auth: true
  rateLimit: true
```

---

Import the file like any other source file.

```ts
import config from "./config.yaml";

config.database.host; // => "localhost"
config.server.port; // => 3000
config.features.auth; // => true
```

---

You can also use named imports to destructure top-level properties:

```ts
import { database, server, features } from "./config.yaml";

console.log(database.name); // => "myapp"
console.log(server.timeout); // => 30
console.log(features.rateLimit); // => true
```

---

Bun also supports [Import Attributes](https://github.com/tc39/proposal-import-attributes) syntax:

```ts
import config from "./config.yaml" with { type: "yaml" };

config.database.port; // => 5432
```

---

For parsing YAML strings at runtime, use `Bun.YAML.parse()`:

```ts
const yamlString = `
name: John Doe
age: 30
hobbies:
  - reading
  - coding
`;

const data = Bun.YAML.parse(yamlString);
console.log(data.name); // => "John Doe"
console.log(data.hobbies); // => ["reading", "coding"]
```

---

See [Docs > API > YAML](https://bun.com/docs/api/yaml) for complete documentation on YAML support in Bun.
