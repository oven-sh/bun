var slice = Array.prototype.slice;
class Dequeue<T> {
  _head: number;
  _tail: number;
  _capacityMask: number;
  _list: (T | undefined)[];

  constructor() {
    this._head = 0;
    this._tail = 0;
    // this._capacity = 0;
    this._capacityMask = 0x3;
    this._list = $newArrayWithSize(4);
  }

  size(): number {
    const head = this._head;
    const tail = this._tail;
    if (head === tail) return 0;
    if (head < tail) return tail - head;
    else return this._capacityMask + 1 - (head - tail);
  }

  isEmpty(): boolean {
    return this.size() == 0;
  }

  isNotEmpty(): boolean {
    return this.size() > 0;
  }

  shift(): T | undefined {
    var { _head: head, _tail, _list, _capacityMask } = this;
    if (head === _tail) return undefined;
    var item = _list[head];
    $putByValDirect(_list, head, undefined);
    head = this._head = (head + 1) & _capacityMask;
    if (head < 2 && _tail > 10000 && _tail <= _list.length >>> 2) this._shrinkArray();
    return item;
  }

  peek(): T | undefined {
    if (this._head === this._tail) return undefined;
    return this._list[this._head];
  }

  push(item: T): void {
    var tail = this._tail;
    $putByValDirect(this._list, tail, item);
    this._tail = (tail + 1) & this._capacityMask;
    if (this._tail === this._head) {
      this._growArray();
    }
  }

  toArray(fullCopy: boolean): T[] {
    var list = this._list;
    var len = $toLength(list.length);
    var head = this._head;
    var tail = this._tail;

    if (fullCopy || head > tail) {
      var _head = $toLength(head);
      var _tail = $toLength(tail);
      var total = $toLength(len - _head + _tail);
      var array = $newArrayWithSize(total);
      var j = 0;
      for (var i = _head; i < len; i++) $putByValDirect(array, j++, list[i]);
      for (var i = 0; i < _tail; i++) $putByValDirect(array, j++, list[i]);
      return array as T[];
    } else {
      return slice.$call(list, head, tail);
    }
  }

  clear(): void {
    this._head = 0;
    this._tail = 0;
    this._list.fill(undefined);
  }

  private _growArray(): void {
    if (this._head) {
      // copy existing data, head to end, then beginning to tail.
      this._list = this.toArray(true);
      this._head = 0;
    }

    // head is at 0 and array is now full, safe to extend
    this._tail = $toLength(this._list.length);

    this._list.length <<= 1;
    this._capacityMask = (this._capacityMask << 1) | 1;
  }

  private _shrinkArray(): void {
    this._list.length >>>= 1;
    this._capacityMask >>>= 1;
  }
}

export default Dequeue;
