class NodePoint {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    add(other) {
        return new NodePoint(this.x + other.x, this.y + other.y);
    }
}
module.exports = NodePoint;
