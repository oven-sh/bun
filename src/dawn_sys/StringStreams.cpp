// With musl, libstdc++ is a shared library, whose operator new is not the executable's. What owns a string is compiled here.

#include <sstream>

template class std::basic_stringbuf<char>;
template class std::basic_istringstream<char>;
template class std::basic_ostringstream<char>;
template class std::basic_stringstream<char>;
