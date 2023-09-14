default:
	$(CXX) -std=c++17 -fsanitize=address Query.cpp -o Query
	./Query
	$(CXX) -std=c++17 -fsanitize=address ChunkedEncoding.cpp -o ChunkedEncoding
	./ChunkedEncoding
	$(CXX) -std=c++17 -fsanitize=address TopicTree.cpp -o TopicTree
	./TopicTree
	$(CXX) -std=c++17 -fsanitize=address HttpRouter.cpp -o HttpRouter
	./HttpRouter
	$(CXX) -std=c++17 -fsanitize=address BloomFilter.cpp -o BloomFilter
	./BloomFilter
	$(CXX) -std=c++17 -fsanitize=address ExtensionsNegotiator.cpp -o ExtensionsNegotiator
	./ExtensionsNegotiator
	$(CXX) -std=c++17 -fsanitize=address HttpParser.cpp -o HttpParser
	./HttpParser

smoke:
	../Crc32 &
	sleep 1
	~/.deno/bin/deno run --allow-net smoke.mjs
	pkill Crc32
