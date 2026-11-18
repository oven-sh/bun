#pragma once

#include "engine/text/TextForward.h"

#include <compare>

namespace WTF {

// A line or a column, which some count from zero and others from one.
class OrdinalNumber {
public:
    OrdinalNumber() = default;

    static OrdinalNumber beforeFirst() { return fromZeroBasedInt(-1); }
    static OrdinalNumber fromOneBasedInt(int value) { return fromZeroBasedInt(value - 1); }
    static OrdinalNumber fromZeroBasedInt(int value)
    {
        OrdinalNumber number;
        number.m_zeroBasedValue = value;
        return number;
    }

    int zeroBasedInt() const { return m_zeroBasedValue; }
    int oneBasedInt() const { return m_zeroBasedValue + 1; }

    friend auto operator<=>(OrdinalNumber, OrdinalNumber) = default;

private:
    int m_zeroBasedValue { 0 };
};

class TextPosition {
public:
    TextPosition() = default;
    TextPosition(OrdinalNumber line, OrdinalNumber column)
        : m_line(line)
        , m_column(column)
    {
    }

    OrdinalNumber m_line;
    OrdinalNumber m_column;
};

}
