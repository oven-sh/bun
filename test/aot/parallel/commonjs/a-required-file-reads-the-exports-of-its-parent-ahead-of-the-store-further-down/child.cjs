var above = module.parent.exports;
module.exports = [typeof above, above && above.marker, typeof (above && above.marker ? above : { default: above }).default].join();
