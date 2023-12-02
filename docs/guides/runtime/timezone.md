---
name: Set a time zone in Bun
---

Bun supports programmatically setting a default time zone for the lifetime of the `bun` process. To do set, set the value of the `TZ` environment variable to a [valid timezone identifier](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

{% callout %}
When running a file with `bun`, the timezone defaults to your system's configured local time zone.

When running tests with `bun test`, the timezone is set to `UTC` to make tests more deterministic.
{% /callout %}

```ts
process.env.TZ = "America/New_York";
```

---

Alternatively, this can be set from the command line when running a Bun command.

```sh
$ TZ=America/New_York bun run dev
```

---

Once `TZ` is set, any `Date` instances will have that time zone. By default all dates use your system's configured time zone.

```ts
new Date().getHours(); // => 18

process.env.TZ = "America/New_York";

new Date().getHours(); // => 21
```
