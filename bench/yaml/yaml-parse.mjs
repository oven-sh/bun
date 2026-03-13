import { bench, group, run } from "../runner.mjs";
import jsYaml from "js-yaml";
import yaml from "yaml";

// Small YAML document
const smallYaml = `
name: John Doe
age: 30
email: john@example.com
active: true
`;

// Medium YAML document with nested structures
const mediumYaml = `
company: Acme Corp
employees:
  - name: John Doe
    age: 30
    position: Developer
    skills:
      - JavaScript
      - TypeScript
      - Node.js
  - name: Jane Smith
    age: 28
    position: Designer
    skills:
      - Figma
      - Photoshop
      - Illustrator
  - name: Bob Johnson
    age: 35
    position: Manager
    skills:
      - Leadership
      - Communication
      - Planning
settings:
  database:
    host: localhost
    port: 5432
    name: mydb
  cache:
    enabled: true
    ttl: 3600
`;

// Large YAML document with complex structures
const largeYaml = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nginx-deployment
  labels:
    app: nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: nginx
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
      - name: nginx
        image: nginx:1.14.2
        ports:
        - containerPort: 80
        env:
        - name: ENV_VAR_1
          value: "value1"
        - name: ENV_VAR_2
          value: "value2"
        volumeMounts:
        - name: config
          mountPath: /etc/nginx
        resources:
          limits:
            cpu: "1"
            memory: "1Gi"
          requests:
            cpu: "0.5"
            memory: "512Mi"
      volumes:
      - name: config
        configMap:
          name: nginx-config
          items:
          - key: nginx.conf
            path: nginx.conf
          - key: mime.types
            path: mime.types
      nodeSelector:
        disktype: ssd
      tolerations:
      - key: "key1"
        operator: "Equal"
        value: "value1"
        effect: "NoSchedule"
      - key: "key2"
        operator: "Exists"
        effect: "NoExecute"
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
            - matchExpressions:
              - key: kubernetes.io/e2e-az-name
                operator: In
                values:
                - e2e-az1
                - e2e-az2
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - web-store
              topologyKey: kubernetes.io/hostname
`;

// YAML with anchors and references
const yamlWithAnchors = `
defaults: &defaults
  adapter: postgresql
  host: localhost
  port: 5432

development:
  <<: *defaults
  database: dev_db

test:
  <<: *defaults
  database: test_db

production:
  <<: *defaults
  database: prod_db
  host: prod.example.com
`;

// Array of items
const arrayYaml = `
- id: 1
  name: Item 1
  price: 10.99
  tags: [electronics, gadgets]
- id: 2
  name: Item 2
  price: 25.50
  tags: [books, education]
- id: 3
  name: Item 3
  price: 5.00
  tags: [food, snacks]
- id: 4
  name: Item 4
  price: 100.00
  tags: [electronics, computers]
- id: 5
  name: Item 5
  price: 15.75
  tags: [clothing, accessories]
`;

// Multiline strings
const multilineYaml = `
description: |
  This is a multiline string
  that preserves line breaks
  and indentation.
  
  It can contain multiple paragraphs
  and special characters: !@#$%^&*()
  
folded: >
  This is a folded string
  where line breaks are converted
  to spaces unless there are
  
  empty lines like above.
plain: This is a plain string
quoted: "This is a quoted string with \\"escapes\\""
literal: 'This is a literal string with ''quotes'''
`;

// Numbers and special values
const numbersYaml = `
integer: 42
negative: -17
float: 3.14159
scientific: 1.23e-4
infinity: .inf
negativeInfinity: -.inf
notANumber: .nan
octal: 0o755
hex: 0xFF
binary: 0b1010
`;

// Dates and timestamps
const datesYaml = `
date: 2024-01-15
datetime: 2024-01-15T10:30:00Z
timestamp: 2024-01-15 10:30:00.123456789 -05:00
canonical: 2024-01-15T10:30:00.123456789Z
`;

// Parse benchmarks
group("parse small YAML", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.parse", () => {
      globalThis.result = Bun.YAML.parse(smallYaml);
    });
  }

  bench("js-yaml.load", () => {
    globalThis.result = jsYaml.load(smallYaml);
  });

  bench("yaml.parse", () => {
    globalThis.result = yaml.parse(smallYaml);
  });
});

group("parse medium YAML", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.parse", () => {
      globalThis.result = Bun.YAML.parse(mediumYaml);
    });
  }

  bench("js-yaml.load", () => {
    globalThis.result = jsYaml.load(mediumYaml);
  });

  bench("yaml.parse", () => {
    globalThis.result = yaml.parse(mediumYaml);
  });
});

group("parse large YAML", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.parse", () => {
      globalThis.result = Bun.YAML.parse(largeYaml);
    });
  }

  bench("js-yaml.load", () => {
    globalThis.result = jsYaml.load(largeYaml);
  });

  bench("yaml.parse", () => {
    globalThis.result = yaml.parse(largeYaml);
  });
});

group("parse YAML with anchors", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.parse", () => {
      globalThis.result = Bun.YAML.parse(yamlWithAnchors);
    });
  }

  bench("js-yaml.load", () => {
    globalThis.result = jsYaml.load(yamlWithAnchors);
  });

  bench("yaml.parse", () => {
    globalThis.result = yaml.parse(yamlWithAnchors);
  });
});

group("parse YAML array", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.parse", () => {
      globalThis.result = Bun.YAML.parse(arrayYaml);
    });
  }

  bench("js-yaml.load", () => {
    globalThis.result = jsYaml.load(arrayYaml);
  });

  bench("yaml.parse", () => {
    globalThis.result = yaml.parse(arrayYaml);
  });
});

group("parse YAML with multiline strings", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.parse", () => {
      globalThis.result = Bun.YAML.parse(multilineYaml);
    });
  }

  bench("js-yaml.load", () => {
    globalThis.result = jsYaml.load(multilineYaml);
  });

  bench("yaml.parse", () => {
    globalThis.result = yaml.parse(multilineYaml);
  });
});

group("parse YAML with numbers", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.parse", () => {
      globalThis.result = Bun.YAML.parse(numbersYaml);
    });
  }

  bench("js-yaml.load", () => {
    globalThis.result = jsYaml.load(numbersYaml);
  });

  bench("yaml.parse", () => {
    globalThis.result = yaml.parse(numbersYaml);
  });
});

group("parse YAML with dates", () => {
  if (typeof Bun !== "undefined" && Bun.YAML) {
    bench("Bun.YAML.parse", () => {
      globalThis.result = Bun.YAML.parse(datesYaml);
    });
  }

  bench("js-yaml.load", () => {
    globalThis.result = jsYaml.load(datesYaml);
  });

  bench("yaml.parse", () => {
    globalThis.result = yaml.parse(datesYaml);
  });
});

// // Stringify benchmarks
// const smallObjJs = jsYaml.load(smallYaml);
// const mediumObjJs = jsYaml.load(mediumYaml);
// const largeObjJs = jsYaml.load(largeYaml);

// group("stringify small object", () => {
//   bench("js-yaml.dump", () => {
//     globalThis.result = jsYaml.dump(smallObjJs);
//   });
// });

// group("stringify medium object", () => {
//   bench("js-yaml.dump", () => {
//     globalThis.result = jsYaml.dump(mediumObjJs);
//   });
// });

// group("stringify large object", () => {
//   bench("js-yaml.dump", () => {
//     globalThis.result = jsYaml.dump(largeObjJs);
//   });
// });

await run();
