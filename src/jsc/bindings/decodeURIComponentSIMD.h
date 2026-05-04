namespace Bun {

// Expected to be ASCII input potentially encoded with %20, %21, etc.
WTF::String decodeURIComponentSIMD(std::span<const uint8_t> input);

JSC_DECLARE_HOST_FUNCTION(jsFunctionDecodeURIComponentSIMD);
}
