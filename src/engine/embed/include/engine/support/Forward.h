#pragma once

#include <cstddef>
#include <cstdint>

namespace WTF {

class AbstractLocker;
class Condition;
class CrashOnOverflow;
class DefaultWeakPtrImpl;
class Lock;
class MonotonicTime;
class Seconds;
class Thread;
class WallTime;

struct FastMalloc;

template<typename> struct DefaultHash;
template<typename> struct DefaultRefDerefTraits;
template<typename> struct HashTraits;
template<typename, typename> struct KeyValuePair;
template<typename> struct RawPtrTraits;
template<typename> struct VectorTraits;

template<typename, size_t inlineCapacity = 0> class Deque;
template<typename> class FixedVector;
template<typename> class Function;
template<typename T, typename = DefaultHash<T>, typename = HashTraits<T>> class HashCountedSet;
template<typename Key, typename Value, typename = DefaultHash<Key>, typename = HashTraits<Key>, typename = HashTraits<Value>> class HashMap;
template<typename T, typename = DefaultHash<T>, typename = HashTraits<T>> class HashSet;
template<typename> class LazyNeverDestroyed;
template<typename T, typename = DefaultHash<T>> class ListHashSet;
template<typename, typename = FastMalloc> class MallocSpan;
template<typename> class NakedPtr;
template<typename> class NeverDestroyed;
template<typename> class ObjectIdentifier;
template<typename> class OptionSet;
template<typename T, typename = RawPtrTraits<T>, typename = DefaultRefDerefTraits<T>> class Ref;
template<typename T, typename = RawPtrTraits<T>, typename = DefaultRefDerefTraits<T>> class RefPtr;
template<typename> class ScopedLambda;
template<typename, size_t segmentSize = 8> class SegmentedVector;
template<typename> class SharedTask;
template<typename> class ThreadSafeWeakPtr;
template<typename> class UniqueRef;
template<typename, size_t inlineCapacity = 0, typename OverflowHandler = CrashOnOverflow, size_t minCapacity = 16, typename Malloc = FastMalloc> class Vector;
template<typename, typename = DefaultWeakPtrImpl> class WeakHashSet;
template<typename, typename = DefaultWeakPtrImpl> class WeakListHashSet;
template<typename, typename = DefaultWeakPtrImpl> class WeakPtr;

}
