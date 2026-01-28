import { bench, group, run } from "../runner.mjs";
import jsYaml from "js-yaml";
import yaml from "yaml";

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

// Large object with complex structures
const largeObject = {
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: {
    name: "nginx-deployment",
    labels: {
      app: "nginx",
    },
  },
  spec: {
    replicas: 3,
    selector: {
      matchLabels: {
        app: "nginx",
      },
    },
    template: {
      metadata: {
        labels: {
          app: "nginx",
        },
      },
      spec: {
        containers: [
          {
            name: "nginx",
            image: "nginx:1.14.2",
            ports: [
              {
                containerPort: 80,
              },
            ],
            env: [
              {
                name: "ENV_VAR_1",
                value: "value1",
              },
              {
                name: "ENV_VAR_2",
                value: "value2",
              },
            ],
            volumeMounts: [
              {
                name: "config",
                mountPath: "/etc/nginx",
              },
            ],
            resources: {
              limits: {
                cpu: "1",
                memory: "1Gi",
              },
              requests: {
                cpu: "0.5",
                memory: "512Mi",
              },
            },
          },
        ],
        volumes: [
          {
            name: "config",
            configMap: {
              name: "nginx-config",
              items: [
                {
                  key: "nginx.conf",
                  path: "nginx.conf",
                },
                {
                  key: "mime.types",
                  path: "mime.types",
                },
              ],
            },
          },
        ],
        nodeSelector: {
          disktype: "ssd",
        },
        tolerations: [
          {
            key: "key1",
            operator: "Equal",
            value: "value1",
            effect: "NoSchedule",
          },
          {
            key: "key2",
            operator: "Exists",
            effect: "NoExecute",
          },
        ],
        affinity: {
          nodeAffinity: {
            requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: [
                {
                  matchExpressions: [
                    {
                      key: "kubernetes.io/e2e-az-name",
                      operator: "In",
                      values: ["e2e-az1", "e2e-az2"],
                    },
                  ],
                },
              ],
            },
          },
          podAntiAffinity: {
            preferredDuringSchedulingIgnoredDuringExecution: [
              {
                weight: 100,
                podAffinityTerm: {
                  labelSelector: {
                    matchExpressions: [
                      {
                        key: "app",
                        operator: "In",
                        values: ["web-store"],
                      },
                    ],
                  },
                  topologyKey: "kubernetes.io/hostname",
                },
              },
            ],
          },
        },
      },
    },
  },
};

// Object with anchors and references (after resolution)
const objectWithAnchors = {
  defaults: {
    adapter: "postgresql",
    host: "localhost",
    port: 5432,
  },
  development: {
    adapter: "postgresql",
    host: "localhost",
    port: 5432,
    database: "dev_db",
  },
  test: {
    adapter: "postgresql",
    host: "localhost",
    port: 5432,
    database: "test_db",
  },
  production: {
    adapter: "postgresql",
    host: "prod.example.com",
    port: 5432,
    database: "prod_db",
  },
};

// Array of items
const arrayObject = [
  {
    id: 1,
    name: "Item 1",
    price: 10.99,
    tags: ["electronics", "gadgets"],
  },
  {
    id: 2,
    name: "Item 2",
    price: 25.5,
    tags: ["books", "education"],
  },
  {
    id: 3,
    name: "Item 3",
    price: 5.0,
    tags: ["food", "snacks"],
  },
  {
    id: 4,
    name: "Item 4",
    price: 100.0,
    tags: ["electronics", "computers"],
  },
  {
    id: 5,
    name: "Item 5",
    price: 15.75,
    tags: ["clothing", "accessories"],
  },
];

// Multiline strings
const multilineObject = {
  description:
    "This is a multiline string\nthat preserves line breaks\nand indentation.\n\nIt can contain multiple paragraphs\nand special characters: !@#$%^&*()\n",
  folded: "This is a folded string where line breaks are converted to spaces unless there are\nempty lines like above.",
  plain: "This is a plain string",
  quoted: 'This is a quoted string with "escapes"',
  literal: "This is a literal string with 'quotes'",
};

// Numbers and special values
const numbersObject = {
  integer: 42,
  negative: -17,
  float: 3.14159,
  scientific: 0.000123,
  infinity: Infinity,
  negativeInfinity: -Infinity,
  notANumber: NaN,
  octal: 493, // 0o755
  hex: 255, // 0xFF
  binary: 10, // 0b1010
};

// Dates and timestamps
const datesObject = {
  date: new Date("2024-01-15"),
  datetime: new Date("2024-01-15T10:30:00Z"),
  timestamp: new Date("2024-01-15T15:30:00.123456789Z"), // Adjusted for UTC-5
  canonical: new Date("2024-01-15T10:30:00.123456789Z"),
};

// Stringify benchmarks
group("stringify small object", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.stringify", () => {
      return Bun.YAML.stringify(smallObject);
    });
  }

  bench("js-yaml.dump", () => {
    return jsYaml.dump(smallObject);
  });

  bench("yaml.stringify", () => {
    return yaml.stringify(smallObject);
  });
});

group("stringify medium object", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.stringify", () => {
      return Bun.YAML.stringify(mediumObject);
    });
  }

  bench("js-yaml.dump", () => {
    return jsYaml.dump(mediumObject);
  });

  bench("yaml.stringify", () => {
    return yaml.stringify(mediumObject);
  });
});

group("stringify large object", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.stringify", () => {
      return Bun.YAML.stringify(largeObject);
    });
  }

  bench("js-yaml.dump", () => {
    return jsYaml.dump(largeObject);
  });

  bench("yaml.stringify", () => {
    return yaml.stringify(largeObject);
  });
});

group("stringify object with anchors", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.stringify", () => {
      return Bun.YAML.stringify(objectWithAnchors);
    });
  }

  bench("js-yaml.dump", () => {
    return jsYaml.dump(objectWithAnchors);
  });

  bench("yaml.stringify", () => {
    return yaml.stringify(objectWithAnchors);
  });
});

group("stringify array", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.stringify", () => {
      return Bun.YAML.stringify(arrayObject);
    });
  }

  bench("js-yaml.dump", () => {
    return jsYaml.dump(arrayObject);
  });

  bench("yaml.stringify", () => {
    return yaml.stringify(arrayObject);
  });
});

group("stringify object with multiline strings", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.stringify", () => {
      return Bun.YAML.stringify(multilineObject);
    });
  }

  bench("js-yaml.dump", () => {
    return jsYaml.dump(multilineObject);
  });

  bench("yaml.stringify", () => {
    return yaml.stringify(multilineObject);
  });
});

group("stringify object with numbers", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.stringify", () => {
      return Bun.YAML.stringify(numbersObject);
    });
  }

  bench("js-yaml.dump", () => {
    return jsYaml.dump(numbersObject);
  });

  bench("yaml.stringify", () => {
    return yaml.stringify(numbersObject);
  });
});

group("stringify object with dates", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.stringify", () => {
      return Bun.YAML.stringify(datesObject);
    });
  }

  bench("js-yaml.dump", () => {
    return jsYaml.dump(datesObject);
  });

  bench("yaml.stringify", () => {
    return yaml.stringify(datesObject);
  });
});

await run();
