// Final benchmark: processStorage + Atomics vs postMessage
const NUM_WORKERS = 5;
const NUM_MESSAGES = 1000;
const MESSAGE_SIZE = 1024;

const measureMemory = () => {
  if (typeof Bun !== 'undefined' && Bun.gc) {
    Bun.gc(true);
  }
  return process.memoryUsage();
};

// Benchmark processStorage + Atomics
const benchmarkProcessStorage = async () => {
  console.log("\n=== ProcessStorage + Atomics Benchmark ===");
  
  const storage = Bun.experimental_processStorage;
  storage.clear();
  
  const sharedBuffer = new SharedArrayBuffer(8 * NUM_WORKERS);
  const counters = new Int32Array(sharedBuffer);
  
  const startMemory = measureMemory();
  
  // Pre-populate storage
  const testData = 'x'.repeat(MESSAGE_SIZE);
  for (let i = 0; i < NUM_MESSAGES; i++) {
    storage.setItem(`msg_${i}`, testData);
  }
  
  const startTime = performance.now();
  
  // Create workers
  const workers = [];
  const promises = [];
  
  for (let w = 0; w < NUM_WORKERS; w++) {
    const worker = new Worker("./benchmark-worker-ps.js");
    workers.push(worker);
    
    const promise = new Promise(resolve => {
      worker.onmessage = (e) => {
        if (e.data.type === 'done') {
          resolve(e.data);
        }
      };
    });
    promises.push(promise);
    
    worker.postMessage({
      type: 'start',
      workerId: w,
      numMessages: NUM_MESSAGES,
      sharedBuffer
    });
  }
  
  const results = await Promise.all(promises);
  const endTime = performance.now();
  const endMemory = measureMemory();
  
  workers.forEach(w => w.terminate());
  storage.clear();
  
  const totalTime = endTime - startTime;
  const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);
  
  return {
    method: 'processStorage + Atomics',
    totalTime,
    totalProcessed,
    throughput: totalProcessed / (totalTime / 1000),
    memoryDelta: endMemory.rss - startMemory.rss,
    results
  };
};

// Benchmark postMessage
const benchmarkPostMessage = async () => {
  console.log("\n=== PostMessage Benchmark ===");
  
  const startMemory = measureMemory();
  const testData = 'x'.repeat(MESSAGE_SIZE);
  
  const startTime = performance.now();
  
  // Create workers
  const workers = [];
  const promises = [];
  
  for (let w = 0; w < NUM_WORKERS; w++) {
    const worker = new Worker("./benchmark-worker-pm.js");
    workers.push(worker);
    
    const promise = new Promise(resolve => {
      worker.onmessage = (e) => {
        if (e.data.type === 'done') {
          resolve(e.data);
        }
      };
    });
    promises.push(promise);
    
    // Start worker
    worker.postMessage({
      type: 'start',
      numMessages: NUM_MESSAGES
    });
    
    // Send messages
    for (let i = 0; i < NUM_MESSAGES; i++) {
      worker.postMessage({
        type: 'message',
        workerId: w,
        data: testData
      });
    }
  }
  
  const results = await Promise.all(promises);
  const endTime = performance.now();
  const endMemory = measureMemory();
  
  workers.forEach(w => w.terminate());
  
  const totalTime = endTime - startTime;
  const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);
  
  return {
    method: 'postMessage',
    totalTime,
    totalProcessed,
    throughput: totalProcessed / (totalTime / 1000),
    memoryDelta: endMemory.rss - startMemory.rss,
    results
  };
};

// Run benchmark
const runBenchmark = async () => {
  console.log(`🚀 ProcessStorage vs PostMessage Benchmark`);
  console.log(`Configuration:`);
  console.log(`- Workers: ${NUM_WORKERS}`);
  console.log(`- Messages per worker: ${NUM_MESSAGES}`);
  console.log(`- Message size: ${MESSAGE_SIZE} bytes`);
  console.log(`- Total messages: ${NUM_MESSAGES * NUM_WORKERS}`);
  
  try {
    const psResult = await benchmarkProcessStorage();
    await new Promise(r => setTimeout(r, 2000)); // Cool down
    const pmResult = await benchmarkPostMessage();
    
    console.log(`\n📊 Results Summary:`);
    console.log(`┌─────────────────────────────┬──────────────────┬──────────────────┐`);
    console.log(`│ Method                      │ processStorage   │ postMessage      │`);
    console.log(`├─────────────────────────────┼──────────────────┼──────────────────┤`);
    console.log(`│ Total Time (ms)             │ ${psResult.totalTime.toFixed(2).padStart(16)} │ ${pmResult.totalTime.toFixed(2).padStart(16)} │`);
    console.log(`│ Throughput (msgs/sec)       │ ${psResult.throughput.toFixed(0).padStart(16)} │ ${pmResult.throughput.toFixed(0).padStart(16)} │`);
    console.log(`│ Memory Delta (KB)           │ ${(psResult.memoryDelta/1024).toFixed(1).padStart(16)} │ ${(pmResult.memoryDelta/1024).toFixed(1).padStart(16)} │`);
    console.log(`│ Messages Processed          │ ${psResult.totalProcessed.toString().padStart(16)} │ ${pmResult.totalProcessed.toString().padStart(16)} │`);
    console.log(`└─────────────────────────────┴──────────────────┴──────────────────┘`);
    
    const speedupRatio = pmResult.totalTime / psResult.totalTime;
    const memoryRatio = psResult.memoryDelta / pmResult.memoryDelta;
    
    console.log(`\n🎯 Performance Analysis:`);
    if (speedupRatio > 1.1) {
      console.log(`✅ processStorage is ${speedupRatio.toFixed(2)}x faster than postMessage`);
    } else if (speedupRatio < 0.9) {
      console.log(`❌ processStorage is ${(1/speedupRatio).toFixed(2)}x slower than postMessage`);
    } else {
      console.log(`🟡 Similar performance (${speedupRatio.toFixed(2)}x)`);
    }
    
    if (memoryRatio > 1.1) {
      console.log(`✅ processStorage uses ${memoryRatio.toFixed(2)}x less memory than postMessage`);
    } else if (memoryRatio < 0.9) {
      console.log(`❌ processStorage uses ${(1/memoryRatio).toFixed(2)}x more memory than postMessage`);
    } else {
      console.log(`🟡 Similar memory usage (${memoryRatio.toFixed(2)}x)`);
    }
    
    console.log(`\n💡 Use Cases Where processStorage Excels:`);
    console.log(`- Shared configuration/state across workers`);
    console.log(`- Caching expensive computations`);
    console.log(`- Real-time coordination with Atomics`);
    console.log(`- Zero-copy string sharing between threads`);
    
  } catch (error) {
    console.error(`❌ Benchmark failed:`, error);
  }
};

runBenchmark();