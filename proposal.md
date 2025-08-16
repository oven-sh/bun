# Proposal: Structured Shared State for JavaScript Concurrency

## Abstract

This proposal introduces a new concurrency model for JavaScript that provides type-safe, transactional shared state management across workers and realms. Built on WebKit's existing infrastructure, it enables high-performance parallel computing while maintaining JavaScript's ease of use and safety guarantees.

## Problem Statement

### Current JavaScript Concurrency Limitations

JavaScript's current concurrency model has significant gaps:

1. **Limited Shared State**: Only SharedArrayBuffer for low-level byte arrays
2. **Serialization Overhead**: postMessage requires expensive cloning for complex objects
3. **Manual Coordination**: Developers must implement their own synchronization primitives
4. **Type Unsafe**: No compile-time guarantees about shared data structures
5. **Race Conditions**: Easy to introduce bugs with manual locking

### Real-World Pain Points

```javascript
// Current approach: Error-prone and inefficient
// 1. Pass large config to every worker (memory waste)
workers.forEach(worker => {
  worker.postMessage({ config: largeConfigObject }); // Serialized N times
});

// 2. Manual coordination with SharedArrayBuffer (complex)
const sharedBuffer = new SharedArrayBuffer(1024);
const view = new Int32Array(sharedBuffer);
// Manual lock implementation, easy to deadlock
while (Atomics.compareExchange(view, 0, 0, 1) !== 0) {
  // Spin wait - inefficient
}

// 3. No structured data sharing
// Can't share Maps, Sets, or custom objects safely
```

## Proposed Solution: Structured Shared State

### Core Principles

1. **Type Safety**: Full TypeScript support with compile-time guarantees
2. **Structured Data**: Share Maps, Arrays, Objects, not just bytes
3. **Transactional**: Software Transactional Memory prevents race conditions
4. **Reactive**: Built-in change notifications across workers
5. **Zero-Copy**: Efficient sharing without serialization overhead
6. **Familiar**: JavaScript-native APIs that compose naturally

### High-Level API Overview

```typescript
// Shared collections with full type safety
const users = new Bun.SharedMap<UserId, User>();
const tasks = new Bun.SharedQueue<Task>();
const metrics = new Bun.SharedRecord<MetricsData>();

// Transactional updates prevent race conditions
await Bun.transaction(() => {
  const user = users.get(userId);
  user.score += points;
  users.set(userId, user);
  tasks.push(new Notification(user.id));
});

// Reactive subscriptions across workers
for await (const change of users.watch(userId)) {
  updateUI(change.newValue);
}

// Structured concurrency
const pool = new Bun.WorkerPool("./worker.js", { size: 4 });
const results = await pool.map(items, processItem);
```

## Detailed API Design

### 1. Shared Collections

#### SharedMap<K, V>
```typescript
class SharedMap<K, V> {
  // Basic operations
  set(key: K, value: V): void;
  get(key: K): V | undefined;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  
  // Iteration
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  entries(): IterableIterator<[K, V]>;
  
  // Reactive operations
  watch(key: K): AsyncIterableIterator<ChangeEvent<V>>;
  watchAll(): AsyncIterableIterator<MapChangeEvent<K, V>>;
  
  // Batch operations
  setMany(entries: Iterable<[K, V]>): void;
  getMany(keys: Iterable<K>): Map<K, V>;
  
  // Metadata
  readonly size: number;
  readonly memory: number; // Memory usage in bytes
}

interface ChangeEvent<V> {
  type: 'set' | 'delete';
  oldValue?: V;
  newValue?: V;
  timestamp: number;
}
```

#### SharedArray<T>
```typescript
class SharedArray<T> {
  // Array-like interface
  get length(): number;
  get(index: number): T | undefined;
  set(index: number, value: T): void;
  push(...items: T[]): number;
  pop(): T | undefined;
  
  // Batch operations
  slice(start?: number, end?: number): T[];
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  
  // Iteration
  [Symbol.iterator](): IterableIterator<T>;
  entries(): IterableIterator<[number, T]>;
  
  // Reactive
  watch(): AsyncIterableIterator<ArrayChangeEvent<T>>;
  watchIndex(index: number): AsyncIterableIterator<ChangeEvent<T>>;
}
```

#### SharedQueue<T>
```typescript
class SharedQueue<T> {
  enqueue(item: T): void;
  dequeue(): Promise<T>; // Waits if empty
  tryDequeue(): T | undefined; // Non-blocking
  
  peek(): T | undefined;
  clear(): void;
  
  readonly size: number;
  readonly isEmpty: boolean;
  
  // Batch operations
  enqueueMany(items: T[]): void;
  dequeueMany(count: number): Promise<T[]>;
  
  // Async iteration
  [Symbol.asyncIterator](): AsyncIterableIterator<T>;
}
```

#### SharedRecord<T>
```typescript
class SharedRecord<T extends Record<string, any>> {
  get<K extends keyof T>(key: K): T[K] | undefined;
  set<K extends keyof T>(key: K, value: T[K]): void;
  
  // Reactive updates
  watch<K extends keyof T>(key: K): AsyncIterableIterator<ChangeEvent<T[K]>>;
  watchAll(): AsyncIterableIterator<RecordChangeEvent<T>>;
  
  // Batch operations  
  update(partial: Partial<T>): void;
  assign(object: Partial<T>): void;
  
  // Conversion
  toObject(): T;
  keys(): (keyof T)[];
  values(): T[keyof T][];
}
```

### 2. Transactions

```typescript
namespace Bun {
  // Software Transactional Memory
  function transaction<T>(fn: () => T | Promise<T>): Promise<T>;
  
  // Optimistic locking with retry
  function transaction<T>(
    fn: () => T | Promise<T>, 
    options: {
      maxRetries?: number;
      backoff?: 'linear' | 'exponential';
      timeout?: number;
    }
  ): Promise<T>;
  
  // Read-only transactions (optimized)
  function readTransaction<T>(fn: () => T | Promise<T>): Promise<T>;
  
  // Manual conflict detection
  function isInTransaction(): boolean;
  function getTransactionId(): string | null;
}
```

### 3. Worker Pool Management

```typescript
class WorkerPool {
  constructor(
    scriptPath: string, 
    options: {
      size?: number;
      maxTasks?: number;
      idleTimeout?: number;
    }
  );
  
  // Parallel execution
  map<T, R>(items: T[], fn: (item: T) => R | Promise<R>): Promise<R[]>;
  
  // Task scheduling
  execute<T>(fn: () => T | Promise<T>): Promise<T>;
  
  // Resource management
  resize(newSize: number): Promise<void>;
  drain(): Promise<void>;
  terminate(): Promise<void>;
  
  // Monitoring
  readonly activeWorkers: number;
  readonly queuedTasks: number;
  readonly completedTasks: number;
}
```

### 4. Structured Concurrency

```typescript
namespace Bun {
  // All-or-nothing parallel execution
  function concurrent<T>(tasks: (() => T | Promise<T>)[]): Promise<T[]>;
  
  // Race with cancellation
  function race<T>(tasks: (() => T | Promise<T>)[]): Promise<T>;
  
  // Timeout with cleanup
  function timeout<T>(
    fn: () => T | Promise<T>, 
    ms: number
  ): Promise<T>;
  
  // Pipeline processing
  function pipeline<T, R>(
    input: AsyncIterable<T>,
    stages: PipelineStage<any, any>[],
    options?: { parallelism?: number }
  ): AsyncIterable<R>;
}
```

## Technical Implementation

### Building on WebKit Infrastructure

The implementation leverages WebKit's existing thread-safe primitives:

```cpp
// Core shared data structure
template<typename K, typename V>
class SharedMap : public ThreadSafeRefCounted<SharedMap<K, V>> {
private:
    mutable Lock m_lock;
    WTF_GUARDED_BY_LOCK(m_lock) HashMap<K, RefPtr<SerializedScriptValue>> m_data;
    WTF_GUARDED_BY_LOCK(m_lock) Vector<WeakPtr<ChangeObserver>> m_observers;
    
public:
    void set(const K& key, RefPtr<SerializedScriptValue> value);
    RefPtr<SerializedScriptValue> get(const K& key) const;
    void notifyObservers(const K& key, ChangeType type);
};

// Transaction implementation using versioned data
class TransactionManager {
private:
    thread_local TransactionContext* s_currentTransaction;
    AtomicCounter m_globalVersion;
    
public:
    template<typename T>
    T executeTransaction(Function<T()>&& fn);
    
    bool validateAndCommit(TransactionContext&);
    void rollback(TransactionContext&);
};
```

### Memory Management

```cpp
// Efficient structured cloning
class SharedValue {
    RefPtr<SerializedScriptValue> m_serialized;
    mutable std::optional<JSValue> m_cachedValue;
    
public:
    // Zero-copy read access when possible
    JSValue toJSValue(JSGlobalObject*) const;
    
    // Efficient updates using copy-on-write
    static Ref<SharedValue> create(JSGlobalObject*, JSValue);
};
```

### Change Notification System

```cpp
// Observer pattern for reactive updates
class ChangeObserver : public CanMakeWeakPtr<ChangeObserver> {
public:
    virtual void notifyChange(const ChangeEvent&) = 0;
    virtual bool isInSameThread() const = 0;
};

// Cross-thread notification queue
class NotificationQueue {
    ThreadSafeQueue<ChangeEvent> m_queue;
    
public:
    void enqueue(ChangeEvent);
    std::optional<ChangeEvent> dequeue();
    void notifyWaiters();
};
```

## Usage Examples

### Example 1: Real-time Game Server

```typescript
// Shared game state across worker threads
const players = new Bun.SharedMap<PlayerId, Player>();
const gameEvents = new Bun.SharedQueue<GameEvent>();
const gameConfig = new Bun.SharedRecord<GameConfig>();

// Worker 1: Handle player connections
async function handlePlayerJoin(playerId: PlayerId, playerData: Player) {
  await Bun.transaction(() => {
    players.set(playerId, playerData);
    gameEvents.enqueue({
      type: 'player_joined',
      playerId,
      timestamp: Date.now()
    });
  });
}

// Worker 2: Game logic
for await (const event of gameEvents) {
  switch (event.type) {
    case 'player_moved':
      await Bun.transaction(() => {
        const player = players.get(event.playerId);
        if (player) {
          player.position = event.newPosition;
          players.set(event.playerId, player);
        }
      });
      break;
  }
}

// Worker 3: Broadcasting updates
for await (const change of players.watchAll()) {
  broadcastToClients({
    type: 'state_update',
    playerId: change.key,
    player: change.newValue
  });
}
```

### Example 2: Data Processing Pipeline

```typescript
// Shared cache for expensive computations
const computationCache = new Bun.SharedMap<string, ProcessedData>();
const workQueue = new Bun.SharedQueue<RawData>();

// Producer: Add work items
async function addWork(data: RawData[]) {
  workQueue.enqueueMany(data);
}

// Worker pool: Process items with caching
const pool = new Bun.WorkerPool('./processor.js', { size: 8 });

async function processItem(item: RawData): Promise<ProcessedData> {
  const cacheKey = hashItem(item);
  
  // Check cache first
  const cached = computationCache.get(cacheKey);
  if (cached) return cached;
  
  // Expensive computation
  const result = await expensiveProcess(item);
  
  // Cache result for other workers
  await Bun.transaction(() => {
    computationCache.set(cacheKey, result);
  });
  
  return result;
}

// Process all items in parallel
const results = await pool.map(workItems, processItem);
```

### Example 3: Configuration Management

```typescript
// Shared application configuration
const appConfig = new Bun.SharedRecord<AppConfig>();
const featureFlags = new Bun.SharedMap<string, boolean>();

// Main thread: Update configuration
async function updateConfig(newConfig: Partial<AppConfig>) {
  await Bun.transaction(() => {
    appConfig.update(newConfig);
  });
  
  console.log('Configuration updated across all workers');
}

// Workers: React to configuration changes
for await (const change of appConfig.watch('apiEndpoint')) {
  // Automatically reconfigure HTTP client
  httpClient.setBaseURL(change.newValue);
}

// Feature flag updates
for await (const change of featureFlags.watchAll()) {
  console.log(`Feature ${change.key} is now ${change.newValue ? 'enabled' : 'disabled'}`);
}
```

## Performance Characteristics

### Memory Efficiency
- **Zero-copy reads**: Multiple workers access same memory
- **Copy-on-write updates**: Efficient handling of large objects
- **Structured cloning**: Only when crossing thread boundaries
- **Automatic cleanup**: Garbage collection handles shared objects

### Concurrency Performance
- **Lock-free reads**: Read transactions don't block
- **Optimistic updates**: Conflicts resolved automatically
- **Batched notifications**: Efficient observer updates
- **Work stealing**: Worker pools balance load automatically

### Scalability
- **Horizontal scaling**: Add workers as needed
- **Memory bounded**: Configurable limits prevent runaway growth
- **Backpressure**: Queues handle flow control
- **Monitoring**: Built-in metrics for optimization

## Migration Path

### From Current postMessage Patterns

```typescript
// Before: Manual message passing
worker.postMessage({ type: 'config', data: config });
worker.onmessage = (e) => {
  if (e.data.type === 'config_updated') {
    // Handle update
  }
};

// After: Reactive shared state
await Bun.transaction(() => {
  sharedConfig.update(config);
});

for await (const change of sharedConfig.watchAll()) {
  // Automatically notified of changes
}
```

### From SharedArrayBuffer

```typescript
// Before: Manual byte-level coordination
const sharedBuffer = new SharedArrayBuffer(1024);
const view = new Int32Array(sharedBuffer);

// Complex manual locking
while (Atomics.compareExchange(view, 0, 0, 1) !== 0) {}
// Critical section
view[1] = newValue;
Atomics.store(view, 0, 0); // Release lock

// After: Transactional updates
await Bun.transaction(() => {
  sharedData.set('key', newValue);
});
```

## Alternative Approaches Considered

### 1. Event-Driven Architecture
**Pros**: Loose coupling, familiar patterns
**Cons**: Harder to maintain consistency, potential race conditions

### 2. Actor Model
**Pros**: Strong isolation, message-passing semantics
**Cons**: Serialization overhead, more complex programming model

### 3. Shared Memory with Manual Locking
**Pros**: Maximum performance, direct control
**Cons**: High complexity, error-prone, deadlock risks

### 4. External State Stores (Redis, etc.)
**Pros**: Proven at scale, persistence
**Cons**: Network overhead, operational complexity

## Implementation Phases

### Phase 1: Core Shared Collections
- SharedMap, SharedArray, SharedQueue
- Basic transaction support
- Single-process implementation

### Phase 2: Advanced Features
- SharedRecord with type safety
- Reactive observers and watchers
- Worker pool management

### Phase 3: Production Hardening
- Performance optimization
- Memory management tuning
- Debugging and monitoring tools

### Phase 4: Ecosystem Integration
- TypeScript integration
- Framework adapters
- Migration utilities

## Security Considerations

### Memory Safety
- All shared data validated through structured cloning
- No direct memory access to prevent corruption
- Automatic bounds checking for collections

### Isolation
- Process-level isolation maintained
- Worker sandboxing preserved
- No cross-origin sharing

### Resource Limits
- Configurable memory limits per shared collection
- Automatic cleanup of orphaned data
- Protection against memory exhaustion

## Conclusion

This proposal addresses fundamental limitations in JavaScript's concurrency model by providing type-safe, efficient shared state management. Built on WebKit's robust infrastructure, it enables new classes of high-performance applications while maintaining JavaScript's accessibility and safety guarantees.

The design balances power and usability, offering advanced developers the tools they need for complex concurrent applications while providing safety rails that prevent common concurrency bugs.

By building on proven patterns from other languages (Software Transactional Memory, reactive programming) and adapting them to JavaScript's strengths, this proposal represents a natural evolution of the platform's concurrency capabilities.