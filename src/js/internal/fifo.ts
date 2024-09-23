var slice = Array.prototype.slice;
class Denqueue {
  constructor() {
    this._head = 0;
    this._tail = 0;
    // this._capacity = 0;
    this._capacityMask = 0x3;
    this._list = $newArrayWithSize(4);
  }

  _head;
  _tail;
  _capacityMask;
  _list;

  size() {
    if (this._head === this._tail) return 0;
    if (this._head < this._tail) return this._tail - this._head;
    else return this._capacityMask + 1 - (this._head - this._tail);
  }

  isEmpty() {
    return this.size() == 0;
  }

  isNotEmpty() {
    return this.size() > 0;
  }

  shift() {
    var { _head: head, _tail, _list, _capacityMask } = this;
    if (head === _tail) return undefined;
    var item = _list[head];
    $putByValDirect(_list, head, undefined);
    head = this._head = (head + 1) & _capacityMask;
    if (head < 2 && _tail > 10000 && _tail <= _list.length >>> 2) this._shrinkArray();
    return item;
  }

  peek() {
    if (this._head === this._tail) return undefined;
    return this._list[this._head];
  }

  push(item) {
    var tail = this._tail;
    $putByValDirect(this._list, tail, item);
    this._tail = (tail + 1) & this._capacityMask;
    if (this._tail === this._head) {
      this._growArray();
    }
    // if (this._capacity && this.size() > this._capacity) {
    // this.shift();
    // }
  }

  toArray(fullCopy) {
    var list = this._list;
    var len = $toLength(list.length);

    if (fullCopy || this._head > this._tail) {
      var _head = $toLength(this._head);
      var _tail = $toLength(this._tail);
      var total = $toLength(len - _head + _tail);
      var array = $newArrayWithSize(total);
      var j = 0;
      for (var i = _head; i < len; i++) $putByValDirect(array, j++, list[i]);
      for (var i = 0; i < _tail; i++) $putByValDirect(array, j++, list[i]);
      return array;
    } else {
      return slice.$call(list, this._head, this._tail);
    }
  }

  clear() {
    this._head = 0;
    this._tail = 0;
    this._list.fill(undefined);
  }

  _growArray() {
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

  _shrinkArray() {
    this._list.length >>>= 1;
    this._capacityMask >>>= 1;
  }
}

export default Denqueue;
