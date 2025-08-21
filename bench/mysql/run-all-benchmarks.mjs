#!/usr/bin/env node

import { spawn } from "child_process";
import { writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ITERATIONS = 3;

const benchmarks = [
  {
    name: "Bun (MySQL2)",
    cmd: ["bun", "./index.mjs"],
    description: "Bun runtime with MySQL2 driver",
    category: "JavaScript Runtime"
  },
  {
    name: "Node.js (MySQL2)",
    cmd: ["node", "./index-mysql2.mjs"], 
    description: "Node.js runtime with MySQL2 driver",
    category: "JavaScript Runtime"
  },
  {
    name: "Rust (SQLx)",
    cmd: ["cargo", "run", "--manifest-path=./rust-sqlx/Cargo.toml", "--release"],
    description: "Native Rust with SQLx async MySQL driver",
    category: "Native Language"
  },
  {
    name: "Go (Native)",
    cmd: ["go", "run", "main.go"],
    description: "Native Go with go-sql-driver/mysql",
    category: "Native Language"
  }
];

class BenchmarkSuite {
  constructor() {
    this.results = [];
  }

  async runCommand(cmd, args, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, {
        stdio: options.silent ? 'pipe' : 'inherit',
        shell: process.platform === 'win32',
        cwd: __dirname
      });

      let output = '';
      if (options.silent) {
        child.stdout?.on('data', (data) => {
          output += data.toString();
        });
        child.stderr?.on('data', (data) => {
          output += data.toString();
        });
      }

      child.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(`Command failed with code ${code}`));
        }
      });

      child.on('error', reject);
    });
  }

  async checkPrerequisites() {
    console.log("🔍 Checking prerequisites...\n");
    
    const checks = [
      { name: "Bun", cmd: "bun", args: ["--version"] },
      { name: "Node.js", cmd: "node", args: ["--version"] },
      { name: "Rust/Cargo", cmd: "cargo", args: ["--version"] },
      { name: "Go", cmd: "go", args: ["version"] }
    ];

    const available = {};
    
    for (const check of checks) {
      try {
        await this.runCommand(check.cmd, check.args, { silent: true });
        console.log(`✅ ${check.name} is available`);
        available[check.name] = true;
      } catch (error) {
        console.log(`❌ ${check.name} is not available`);
        available[check.name] = false;
      }
    }
    
    console.log();
    return available;
  }

  async setup() {
    console.log("🏗️  Setting up dependencies...\n");
    
    // Install JavaScript dependencies
    try {
      await this.runCommand("bun", ["install"], { silent: true });
      console.log("✅ JavaScript dependencies installed");
    } catch {
      console.log("⚠️  Failed to install JavaScript dependencies");
    }
    
    // Setup Rust dependencies
    if (existsSync("rust-sqlx/Cargo.toml")) {
      try {
        await this.runCommand("cargo", ["build", "--release", "--manifest-path=./rust-sqlx/Cargo.toml"], { silent: true });
        console.log("✅ Rust dependencies built");
      } catch {
        console.log("⚠️  Failed to build Rust dependencies");
      }
    }
    
    // Setup Go dependencies  
    try {
      await this.runCommand("go", ["mod", "tidy"], { silent: true });
      console.log("✅ Go dependencies ready");
    } catch {
      console.log("⚠️  Failed to setup Go dependencies");
    }
    
    console.log();
  }

  extractTime(output) {
    // Try to extract timing from various output formats
    const patterns = [
      /(\d+\.?\d*)\s*ms/,           // "1234.56ms"
      /(\d+\.?\d*)\s*milliseconds/, // "1234.56 milliseconds" 
      /(\d+\.?\d*)ms/,             // "1234.56ms" (no space)
    ];
    
    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        return parseFloat(match[1]);
      }
    }
    
    return null;
  }

  async runBenchmark(benchmark) {
    console.log(`\n🚀 Running ${benchmark.name}...`);
    
    const times = [];
    
    for (let i = 0; i < ITERATIONS; i++) {
      try {
        console.log(`  Iteration ${i + 1}/${ITERATIONS}...`);
        
        const start = Date.now();
        const output = await this.runCommand(benchmark.cmd[0], benchmark.cmd.slice(1), { silent: true });
        const wallTime = Date.now() - start;
        
        // Try to extract reported time, fall back to wall time
        const reportedTime = this.extractTime(output);
        const time = reportedTime || wallTime;
        
        times.push(time);
        console.log(`    ${time.toFixed(2)}ms`);
        
      } catch (error) {
        console.log(`    ❌ Failed: ${error.message}`);
        return null;
      }
    }
    
    const average = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const stdDev = Math.sqrt(times.reduce((sq, n) => sq + Math.pow(n - average, 2), 0) / times.length);
    
    return {
      name: benchmark.name,
      category: benchmark.category,
      description: benchmark.description,
      times,
      average,
      min,
      max,
      stdDev
    };
  }

  async runAllBenchmarks(available) {
    console.log("🏁 MySQL Performance Benchmark Suite");
    console.log("=====================================");
    console.log("Each benchmark performs 100,000 SELECT queries with LIMIT 100");
    console.log("Same database, same query, same batching strategy\n");
    
    // Filter benchmarks based on available tools
    const runnableBenchmarks = benchmarks.filter(b => {
      if (b.name.includes("Bun")) return available["Bun"];
      if (b.name.includes("Node.js")) return available["Node.js"];
      if (b.name.includes("Rust")) return available["Rust/Cargo"];
      if (b.name.includes("Go")) return available["Go"];
      return true;
    });
    
    for (const benchmark of runnableBenchmarks) {
      const result = await this.runBenchmark(benchmark);
      if (result) {
        this.results.push(result);
      }
    }
  }

  generateMarkdownReport() {
    if (this.results.length === 0) {
      return "# No benchmark results to report\n";
    }

    const timestamp = new Date().toISOString();
    const sortedResults = this.results.sort((a, b) => a.average - b.average);
    const fastest = sortedResults[0];
    
    let markdown = `# 🔥 MySQL Performance Benchmark Results

*Generated on: ${timestamp}*

## The Challenge

Each runtime performs **100,000 SELECT queries** with \`LIMIT 100\` against the same MySQL database containing 100 user records.

### Test Configuration
- **Query**: \`SELECT * FROM users_bun_bench LIMIT 100\`
- **Total Queries**: 100,000
- **Batch Size**: 100 queries per batch
- **Database**: MySQL (localhost)
- **Iterations**: ${ITERATIONS} runs per benchmark
- **Metric**: Average response time in milliseconds

## 📊 Results

| Rank | Runtime | Avg (ms) | Min (ms) | Max (ms) | Std Dev | vs Fastest |
|------|---------|----------|----------|----------|---------|------------|
`;

    sortedResults.forEach((result, index) => {
      const rank = index === 0 ? "🥇" : index === 1 ? "🥈" : index === 2 ? "🥉" : `${index + 1}.`;
      const vsSpeed = index === 0 ? "**CHAMPION**" : `${(result.average / fastest.average).toFixed(2)}x slower`;
      
      markdown += `| ${rank} | **${result.name}** | ${result.average.toFixed(2)} | ${result.min.toFixed(2)} | ${result.max.toFixed(2)} | ${result.stdDev.toFixed(2)} | ${vsSpeed} |\n`;
    });

    markdown += `\n## 📈 Detailed Analysis\n\n`;

    // Group by category
    const categories = [...new Set(sortedResults.map(r => r.category))];
    
    for (const category of categories) {
      markdown += `### ${category}\n\n`;
      const categoryResults = sortedResults.filter(r => r.category === category);
      
      for (const result of categoryResults) {
        markdown += `#### ${result.name}
- **Description**: ${result.description}
- **Average Time**: ${result.average.toFixed(2)}ms
- **Best Run**: ${result.min.toFixed(2)}ms  
- **Worst Run**: ${result.max.toFixed(2)}ms
- **Consistency**: ±${result.stdDev.toFixed(2)}ms standard deviation
- **All Runs**: [${result.times.map(t => t.toFixed(1)).join(', ')}]ms

`;
      }
    }

    // Performance insights
    markdown += `## 🎯 Key Insights\n\n`;
    
    if (fastest.name.includes("Bun")) {
      markdown += `🏆 **Bun dominates the JavaScript runtime category!** Even using the same MySQL2 driver as Node.js, Bun's superior JavaScript engine and async I/O handling deliver ${fastest.average.toFixed(2)}ms average performance.

`;
    }
    
    const jsResults = sortedResults.filter(r => r.category === "JavaScript Runtime");
    const nativeResults = sortedResults.filter(r => r.category === "Native Language");
    
    if (jsResults.length > 0 && nativeResults.length > 0) {
      const fastestJs = jsResults[0];
      const fastestNative = nativeResults[0];
      
      if (fastestJs.average < fastestNative.average) {
        markdown += `🚀 **JavaScript runtime beats native languages!** ${fastestJs.name} (${fastestJs.average.toFixed(2)}ms) outperforms ${fastestNative.name} (${fastestNative.average.toFixed(2)}ms) by ${((fastestNative.average / fastestJs.average - 1) * 100).toFixed(1)}%.

This demonstrates how modern JavaScript engines combined with optimized I/O can compete with and even exceed traditional "systems" languages for database operations.

`;
      } else {
        markdown += `⚔️  **Close competition!** ${fastestNative.name} (${fastestNative.average.toFixed(2)}ms) edges out ${fastestJs.name} (${fastestJs.average.toFixed(2)}ms) by ${((fastestJs.average / fastestNative.average - 1) * 100).toFixed(1)}%.

`;
      }
    }

    markdown += `## 🔧 Environment Details

- **Test Database**: MySQL running on localhost
- **Connection**: Standard TCP connection (root user, no password) 
- **Table Schema**: Auto-increment ID, VARCHAR fields, DATE field
- **Data Set**: 100 users with deterministic test data
- **Hardware**: Same machine for all tests
- **Concurrency**: Batch-parallel execution (100 queries per batch)

## 🧪 Methodology

All benchmarks follow identical patterns:

1. **Setup**: Create table and populate with 100 identical test records
2. **Execution**: Run 100,000 SELECT queries in batches of 100
3. **Measurement**: Record total execution time using high-precision timers
4. **Statistics**: Average across ${ITERATIONS} independent runs

Each implementation uses the most popular MySQL driver for its ecosystem:
- **JavaScript**: mysql2 (most popular Node.js MySQL driver)
- **Rust**: SQLx (most popular async Rust database toolkit)  
- **Go**: go-sql-driver/mysql (standard Go MySQL driver)

---

*Want to reproduce these results? Check the benchmark source code and run \`bun run-all-benchmarks.mjs\`*
`;

    return markdown;
  }

  async saveResults() {
    const markdown = this.generateMarkdownReport();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `mysql-benchmark-${timestamp}.md`;
    
    writeFileSync(filename, markdown);
    console.log(`\n📄 Full report saved to: ${filename}`);
    
    writeFileSync("BENCHMARK_RESULTS.md", markdown);
    console.log(`📄 Latest results: BENCHMARK_RESULTS.md`);
    
    return markdown;
  }
}

// Main execution
async function main() {
  const suite = new BenchmarkSuite();
  
  try {
    const available = await suite.checkPrerequisites();
    await suite.setup();
    await suite.runAllBenchmarks(available);
    
    if (suite.results.length === 0) {
      console.log("\n❌ No benchmarks completed successfully");
      console.log("Make sure MySQL server is running on localhost:3306 with 'test' database");
      return;
    }
    
    await suite.saveResults();
    
    // Print summary
    const sorted = suite.results.sort((a, b) => a.average - b.average);
    console.log("\n🏆 Final Rankings:");
    sorted.forEach((result, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
      console.log(`${medal} ${result.name}: ${result.average.toFixed(2)}ms avg`);
    });
    
  } catch (error) {
    console.error("❌ Benchmark suite failed:", error.message);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}