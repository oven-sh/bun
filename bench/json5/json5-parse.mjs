import JSON5 from "json5";
import { bench, group, run } from "../runner.mjs";

// Small JSON5 document with comments and unquoted keys
const smallJson5 = `{
  // User profile
  name: "John Doe",
  age: 30,
  email: 'john@example.com',
  active: true,
}`;

// Medium JSON5 document with nested structures, hex, trailing commas
const mediumJson5 = `{
  company: "Acme Corp",
  /* Employee list */
  employees: [
    {
      name: "John Doe",
      age: 30,
      position: 'Developer',
      skills: ['JavaScript', 'TypeScript', 'Node.js',],
    },
    {
      name: "Jane Smith",
      age: 0x1C, // 28 in hex
      position: 'Designer',
      skills: ['Figma', 'Photoshop', 'Illustrator',],
    },
    {
      name: "Bob Johnson",
      age: 35,
      position: 'Manager',
      skills: ['Leadership', 'Communication', 'Planning',],
    },
  ],
  settings: {
    database: {
      host: 'localhost',
      port: 5432,
      name: 'mydb',
    },
    cache: {
      enabled: true,
      ttl: 3600,
    },
  },
}`;

// Large JSON5 document with JSON5-specific features
const largeJson5 = `{
  // Kubernetes deployment config
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: {
    name: 'nginx-deployment',
    labels: {
      app: 'nginx',
      version: 'v1.14.2',
    },
  },
  spec: {
    replicas: 3,
    maxUnavailable: Infinity,
    selector: {
      matchLabels: {
        app: 'nginx',
      },
    },
    template: {
      metadata: {
        labels: {
          app: 'nginx',
        },
      },
      spec: {
        containers: [
          {
            name: 'nginx',
            image: 'nginx:1.14.2',
            ports: [
              { containerPort: 80, },
            ],
            env: [
              { name: 'ENV_VAR_1', value: 'value1', },
              { name: 'ENV_VAR_2', value: 'value2', },
              { name: 'HEX_VAR', value: 'ff', code: 0xFF, },
            ],
            volumeMounts: [
              { name: 'config', mountPath: '/etc/nginx', },
            ],
            resources: {
              limits: {
                cpu: '1',
                memory: '1Gi',
              },
              requests: {
                cpu: '0.5',
                memory: '512Mi',
              },
            },
          },
        ],
        volumes: [
          {
            name: 'config',
            configMap: {
              name: 'nginx-config',
              items: [
                { key: 'nginx.conf', path: 'nginx.conf', },
                { key: 'mime.types', path: 'mime.types', },
              ],
            },
          },
        ],
        nodeSelector: {
          disktype: 'ssd',
        },
        tolerations: [
          {
            key: 'key1',
            operator: 'Equal',
            value: 'value1',
            effect: 'NoSchedule',
          },
          {
            key: 'key2',
            operator: 'Exists',
            effect: 'NoExecute',
          },
        ],
      },
    },
  },
}`;

// Generate a very large JSON5 string (~100KB) with many entries
function generateLargeJson5(count) {
  const lines = ["{\n  // Auto-generated dataset\n  items: [\n"];
  for (let i = 0; i < count; i++) {
    lines.push(`    {
      id: ${i},
      name: 'item_${i}',
      value: ${(Math.random() * 1000).toFixed(2)},
      hex: 0x${i.toString(16).toUpperCase()},
      active: ${i % 2 === 0},
      tags: ['tag_${i % 10}', 'category_${i % 5}',],
      // entry ${i}
    },\n`);
  }
  lines.push("  ],\n  total: " + count + ",\n  status: 'complete',\n}\n");
  return lines.join("");
}

const veryLargeJson5 = generateLargeJson5(1000);

group("parse small JSON5", () => {
  if (typeof Bun !== "undefined" && Bun.JSON5) {
    bench("Bun.JSON5.parse", () => {
      return Bun.JSON5.parse(smallJson5);
    });
  }

  bench("json5.parse", () => {
    return JSON5.parse(smallJson5);
  });
});

group("parse medium JSON5", () => {
  if (typeof Bun !== "undefined" && Bun.JSON5) {
    bench("Bun.JSON5.parse", () => {
      return Bun.JSON5.parse(mediumJson5);
    });
  }

  bench("json5.parse", () => {
    return JSON5.parse(mediumJson5);
  });
});

group("parse large JSON5", () => {
  if (typeof Bun !== "undefined" && Bun.JSON5) {
    bench("Bun.JSON5.parse", () => {
      return Bun.JSON5.parse(largeJson5);
    });
  }

  bench("json5.parse", () => {
    return JSON5.parse(largeJson5);
  });
});

group(`parse very large JSON5 (${(veryLargeJson5.length / 1024).toFixed(0)}KB)`, () => {
  if (typeof Bun !== "undefined" && Bun.JSON5) {
    bench("Bun.JSON5.parse", () => {
      return Bun.JSON5.parse(veryLargeJson5);
    });
  }

  bench("json5.parse", () => {
    return JSON5.parse(veryLargeJson5);
  });
});

await run();
