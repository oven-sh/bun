#ifndef BUN_UTIL_FUNCTIONAL_HPP
#define BUN_UTIL_FUNCTIONAL_HPP

namespace Util::Functional {

/// @brief Combines multiple lambda expressions into a single callable object.
///
/// Example:
/// @code{.cpp}
/// auto visitor = Overloaded {
///    [](int i) { /* handle int */ },
///    [](const std::string& str) { /* handle string */ },
///    [](double d) { /* handle double */ }
/// };
///
/// std::variant<int, std::string, double> var = /* ... */;
/// std::visit(visitor, var);
/// @endcode
template <typename... Lambdas>
struct Overloaded : Lambdas... {
    using Lambdas::operator()...;
};

}  // namespace util::functional

#endif // BUN_UTIL_FUNCTIONAL_HPP
