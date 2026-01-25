import JSON5 from "json5";
import { bench, group, run } from "../runner.mjs";

// Small object
const smallObject = {
  name: "John Doe",
  age: 30,
  email: "john@example.com",
  active: true,
};

// Medium object with nested structures
const mediumObject = {
  company: "Acme Corp",
  employees: [
    {
      name: "John Doe",
      age: 30,
      position: "Developer",
      skills: ["JavaScript", "TypeScript", "Node.js"],
    },
    {
      name: "Jane Smith",
      age: 28,
      position: "Designer",
      skills: ["Figma", "Photoshop", "Illustrator"],
    },
    {
      name: "Bob Johnson",
      age: 35,
      position: "Manager",
      skills: ["Leadership", "Communication", "Planning"],
    },
  ],
  settings: {
    database: {
      host: "localhost",
      port: 5432,
      name: "mydb",
    },
    cache: {
      enabled: true,
      ttl: 3600,
    },
  },
};

// Large object
const largeObject = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: {
    name: "nginx-deployment",
    labels: { app: "nginx" },
  },
  spec: {
    replicas: 3,
    maxUnavailable: Infinity,
    selector: { matchLabels: { app: "nginx" } },
    template: {
      metadata: { labels: { app: "nginx" } },
      spec: {
        containers: [
          {
            name: "nginx",
            image: "nginx:1.14.2",
            ports: [{ containerPort: 80 }],
            env: [
              { name: "ENV_VAR_1", value: "value1" },
              { name: "ENV_VAR_2", value: "value2" },
            ],
            volumeMounts: [{ name: "config", mountPath: "/etc/nginx" }],
            resources: {
              limits: { cpu: "1", memory: "1Gi" },
              requests: { cpu: "0.5", memory: "512Mi" },
            },
          },
        ],
        volumes: [
          {
            name: "config",
            configMap: {
              name: "nginx-config",
              items: [
                { key: "nginx.conf", path: "nginx.conf" },
                { key: "mime.types", path: "mime.types" },
              ],
            },
          },
        ],
        nodeSelector: { disktype: "ssd" },
        tolerations: [
          { key: "key1", operator: "Equal", value: "value1", effect: "NoSchedule" },
          { key: "key2", operator: "Exists", effect: "NoExecute" },
        ],
      },
    },
  },
};

// Very large object (~1000 entries)
const veryLargeObject = {
  items: Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    name: `item_${i}`,
    value: +(Math.random() * 1000).toFixed(2),
    active: i % 2 === 0,
    tags: [`tag_${i % 10}`, `category_${i % 5}`],
  })),
  total: 1000,
  status: "complete",
};

// Object with special JSON5 values
const specialValues = {
  posInf: Infinity,
  negInf: -Infinity,
  nan: NaN,
  deep: {
    nested: {
      value: 42,
      str: "hello\nworld",
      arr: [1, 2, 3, null, true, false],
    },
  },
};

group("stringify small object", () => {
  if (typeof Bun !== "undefined" && Bun.JSON5) {
    bench("Bun.JSON5.stringify", () => {
      return Bun.JSON5.stringify(smallObject);
    });
  }

  bench("json5.stringify", () => {
    return JSON5.stringify(smallObject);
  });
});

group("stringify medium object", () => {
  if (typeof Bun !== "undefined" && Bun.JSON5) {
    bench("Bun.JSON5.stringify", () => {
      return Bun.JSON5.stringify(mediumObject);
    });
  }

  bench("json5.stringify", () => {
    return JSON5.stringify(mediumObject);
  });
});

group("stringify large object", () => {
  if (typeof Bun !== "undefined" && Bun.JSON5) {
    bench("Bun.JSON5.stringify", () => {
      return Bun.JSON5.stringify(largeObject);
    });
  }

  bench("json5.stringify", () => {
    return JSON5.stringify(largeObject);
  });
});

group("stringify very large object (1000 items)", () => {
  if (typeof Bun !== "undefined" && Bun.JSON5) {
    bench("Bun.JSON5.stringify", () => {
      return Bun.JSON5.stringify(veryLargeObject);
    });
  }

  bench("json5.stringify", () => {
    return JSON5.stringify(veryLargeObject);
  });
});

group("stringify with indentation", () => {
  if (typeof Bun !== "undefined" && Bun.JSON5) {
    bench("Bun.JSON5.stringify", () => {
      return Bun.JSON5.stringify(mediumObject, null, 2);
    });
  }

  bench("json5.stringify", () => {
    return JSON5.stringify(mediumObject, null, 2);
  });
});

group("stringify special values (Infinity, NaN)", () => {
  if (typeof Bun !== "undefined" && Bun.JSON5) {
    bench("Bun.JSON5.stringify", () => {
      return Bun.JSON5.stringify(specialValues);
    });
  }

  bench("json5.stringify", () => {
    return JSON5.stringify(specialValues);
  });
});

await run();
