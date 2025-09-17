// file: bench/living_memory_bench.js

const { LivingMemoryAllocator } = require('../src/bun-optimizations/living_memory_allocator');

// Compare with standard allocation
function runStandardBenchmark() {
  console.log("Running standard allocation benchmark...");
  const start = performance.now();
  
  const buffers = [];
  for (let i = 0; i < 10000; i++) {
    const size = Math.floor(Math.random() * 1000) + 100;
    const buffer = new Uint8Array(size);
    
    // Do some work with the buffer
    for (let j = 0; j < Math.min(size, 100); j++) {
      buffer[j] = j % 256;
    }
    
    buffers.push(buffer);
    
    // Randomly free some buffers
    if (Math.random() < 0.7 && buffers.length > 0) {
      const index = Math.floor(Math.random() * buffers.length);
      buffers.splice(index, 1);
    }
  }
  
  const end = performance.now();
  return end - start;
}

// Run benchmark with living memory allocator
function runLivingMemoryBenchmark() {
  console.log("Running living memory allocator benchmark...");
  const allocator = new LivingMemoryAllocator();
  const start = performance.now();
  
  const regions = [];
  for (let i = 0; i < 10000; i++) {
    const size = Math.floor(Math.random() * 1000) + 100;
    const region = allocator.allocate(size, `test-${i}`);
    
    // Do some work with the buffer
    const view = region.view;
    for (let j = 0; j < Math.min(view.length, 100); j++) {
      view[j] = j % 256;
    }
    
    regions.push(region.id);
    
    // Randomly access some existing regions
    if (regions.length > 0 && Math.random() < 0.3) {
      const index = Math.floor(Math.random() * regions.length);
      allocator.access(regions[index]);
    }
    
    // Randomly free some regions
    if (Math.random() < 0.7 && regions.length > 0) {
      const index = Math.floor(Math.random() * regions.length);
      allocator.free(regions[index]);
      regions.splice(index, 1);
    }
  }
  
  const end = performance.now();
  return end - start;
}

// Run benchmarks
async function runBenchmarks() {
  console.log("=== Memory Allocator Benchmark ===\n");
  
  // Warm up
  await runStandardBenchmark();
  await runLivingMemoryBenchmark();
  
  // Actual benchmarks
  const standardTime = await runStandardBenchmark();
  console.log(`Standard allocation time: ${standardTime.toFixed(2)}ms`);
  
  const livingTime = await runLivingMemoryBenchmark();
  console.log(`Living memory allocation time: ${livingTime.toFixed(2)}ms`);
  
  const improvement = ((standardTime - livingTime) / standardTime) * 100;
  console.log(`\nImprovement: ${improvement.toFixed(2)}%`);
  
  console.log("\nNote: The living memory allocator provides additional benefits:");
  console.log("- Improved cache coherence through controlled drift");
  console.log("- Pattern recognition for optimizing allocation strategies");
  console.log("- Fuzzy matching for more flexible memory access");
}

runBenchmarks();
